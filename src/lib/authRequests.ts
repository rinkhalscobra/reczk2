export const authRequestError = async (error: unknown): Promise<Error> => {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: Response }).context;
    const body = await context?.clone().json().catch(() => null);
    if (typeof body?.error === 'string') return new Error(body.error);
  }
  return new Error('Account access is temporarily unavailable. Please try again.');
};
