export type ConfigureLoggerMessage = {
  type: 'configureLogger';
  enabled: boolean;
  level: 'debug' | 'info' | 'warn' | 'error' | 'silent';
  namespaceBase?: string;
  sessionId?: string;
};

export type LogEntryMessage = {
  type: 'log';
  entry: {
    timestampMs: number;
    level: 'debug' | 'info' | 'warn' | 'error';
    namespace: string;
    message: string;
    data?: unknown;
    sessionId?: string;
  };
};

export type ParentToFrameMessage =
  | { type: 'configure'; themeVars: Record<string, string> }
  | { type: 'configure'; applePayEnabled: boolean }
  | { type: 'PING_FROM_PARENT' }
  | { type: 'tokenise' }
  | { type: 'getExpiry' }
  | ConfigureLoggerMessage;

export type FrameToParentMessage =
  | { type: 'ready' }
  | { type: 'error'; code?: string; message?: string }
  | { type: 'tokenised'; cardToken: string }
  | { type: 'expiry'; expiry: string }
  | LogEntryMessage;

export const IFRAME_ERROR = 'IFRAME_ERROR' as const;
