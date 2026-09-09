// Shared helpers for detecting/creating "session expired" errors that flow across the
// tokenise (iframe), 3DS authenticate, and payment calls, all of which are keyed by sessionId
// and can 401 once the backend session TTL has elapsed.

export const SESSION_EXPIRED_CODE = 'SESSION_EXPIRED';

export function makeSessionExpiredError(message: string): Error {
  const error = new Error(message);
  (error as any).code = SESSION_EXPIRED_CODE;
  return error;
}

export function isSessionExpiredError(error: unknown): boolean {
  if (!error) return false;
  if ((error as any)?.code === SESSION_EXPIRED_CODE) return true;
  const message = (error as Error)?.message ?? '';
  return /\(401\)/.test(message);
}
