export type ParentToFrameMessage =
  | { type: 'configure'; themeVars: Record<string, string> }
  | { type: 'PING_FROM_PARENT' }
  | { type: 'tokenise' }
  | { type: 'getExpiry' };

export type FrameToParentMessage =
  | { type: 'ready' }
  | { type: 'error'; code?: string; message?: string }
  | { type: 'tokenised'; cardToken: string }
  | { type: 'expiry'; expiry: string };

export const IFRAME_ERROR = 'IFRAME_ERROR' as const;
