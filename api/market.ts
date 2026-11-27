import type { IncomingMessage, ServerResponse } from 'node:http';

type RequestWithBody = IncomingMessage & { body?: unknown };

const readBody = async (request: RequestWithBody) => {
  if (request.body) {
    return typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
};

const corsOrigin = (request: IncomingMessage) => {
  const configured = process.env.PUBLIC_SITE_URL || process.env.VITE_PUBLIC_SITE_URL;
  if (!configured) return '*';
  const allowed = configured.replace(/\/+$/, '');
  return request.headers.origin === allowed ? allowed : 'null';
};

export default async function handler(request: RequestWithBody, response: ServerResponse) {
  response.setHeader('Access-Control-Allow-Origin', corsOrigin(request));
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Vary', 'Origin');

  if (request.method === 'OPTIONS') {
    response.statusCode = 204;
    response.end();
    return;
  }

  if (request.method !== 'POST') {
    response.statusCode = 405;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    response.statusCode = 500;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ error: 'Market API is not configured' }));
    return;
  }

  try {
    const body = await readBody(request);
    const upstream = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/crypto-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify(body),
    });
    const payload = await upstream.text();
    response.statusCode = upstream.status;
    response.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    response.end(payload);
  } catch (error) {
    response.statusCode = 502;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      error: error instanceof Error ? error.message : 'Market API request failed',
    }));
  }
}
