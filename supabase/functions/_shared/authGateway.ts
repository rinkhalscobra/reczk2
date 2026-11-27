import type { Session, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const authCors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
export const authJson = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status, headers: { ...authCors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
export class GatewayError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
const hex = (value: Uint8Array) => Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
const sourceAddress = (req: Request) => req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

export const limitAuthRequests = async (req: Request, admin: SupabaseClient, secret: string, scope: string, email: string) => {
  const { data, error } = await admin.rpc('consume_account_auth_attempt', {
    p_email_key: hex(await digest(`${secret}:${scope}:email:${email}`)),
    p_ip_key: hex(await digest(`${secret}:${scope}:ip:${sourceAddress(req)}`)),
  });
  if (error || typeof data !== 'boolean') throw new GatewayError(503, 'Sign in is temporarily unavailable. Please try again.');
  if (!data) throw new GatewayError(429, 'Too many attempts. Please wait a few minutes and try again.');
};

type LoginTicket = { purpose: 'account-login'; session: Session; email: string; expires: number; source: string };
const ticketKey = async (secret: string) => crypto.subtle.importKey('raw', await digest(`account-login:v1:${secret}`), 'AES-GCM', false, ['encrypt', 'decrypt']);

export const sealLoginTicket = async (session: Session, email: string, req: Request, secret: string) => {
  const payload: LoginTicket = { purpose: 'account-login', session, email, expires: Date.now() + 180_000, source: hex(await digest(sourceAddress(req))) };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await ticketKey(secret), new TextEncoder().encode(JSON.stringify(payload))));
  const bytes = new Uint8Array(iv.length + ciphertext.length);
  bytes.set(iv); bytes.set(ciphertext, iv.length);
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
};

export const openLoginTicket = async (ticket: string, req: Request, secret: string): Promise<LoginTicket> => {
  try {
    if (ticket.length > 20_000) throw new Error('Invalid ticket');
    const bytes = Uint8Array.from(atob(ticket), character => character.charCodeAt(0));
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await ticketKey(secret), bytes.slice(12));
    const payload: LoginTicket = JSON.parse(new TextDecoder().decode(plaintext));
    if (payload.purpose !== 'account-login' || payload.expires <= Date.now() || !payload.session?.user?.id ||
        payload.source !== hex(await digest(sourceAddress(req)))) throw new Error('Invalid ticket');
    return payload;
  } catch { throw new GatewayError(401, 'This sign-in attempt expired. Please sign in again.'); }
};

export const gatewayFailure = (error: unknown) => error instanceof GatewayError
  ? authJson(error.status, { error: error.message })
  : authJson(503, { error: 'Account access is temporarily unavailable. Please try again.' });
