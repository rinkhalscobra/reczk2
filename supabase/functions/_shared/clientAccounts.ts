export const isDuplicateEmailError = (error: { code?: string; message?: string } | null) =>
  !!error && (
    error.code === 'email_exists' || error.code === 'user_already_exists' ||
    /already (?:been )?registered|email.*already exists/i.test(error.message || '')
  );

/** Internal Auth identities are never a fallback for a user-facing address. */
export const publicContactEmail = (user: { email?: string | null; user_metadata?: Record<string, unknown> }) => {
  const contact = user.user_metadata?.display_email;
  if (typeof contact === 'string' && contact && !/\+(?:account|case)-[a-f0-9]{32}@/i.test(contact)) return contact;
  return user.email && !/\+(?:account|case)-[a-f0-9]{32}@/i.test(user.email) ? user.email : '';
};

export const normalizeCaseNumber = (value: unknown) => typeof value === 'string' ? value.trim() : '';
export const isValidCaseNumber = (value: string) => value.length > 0 && value.length <= 100 && Array.from(value).every(character => {
  const code = character.charCodeAt(0);
  return code >= 32 && code !== 127;
});

/** Deterministic Auth adapter for the public email/case-number identity. */
export const createCaseLoginEmail = async (email: string, caseNumber: string) => {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  if (at <= 0 || at === normalized.length - 1) throw new Error('A valid email is required');
  // Keep existing Auth identities stable and case-insensitive. Displayed case
  // numbers retain the capitalization chosen by the user.
  const identity = new TextEncoder().encode(JSON.stringify([normalized, normalizeCaseNumber(caseNumber).toUpperCase()]));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', identity));
  const suffix = `+case-${Array.from(digest.slice(0, 16), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  return `${normalized.slice(0, at).slice(0, 64 - suffix.length)}${suffix}${normalized.slice(at)}`;
};
