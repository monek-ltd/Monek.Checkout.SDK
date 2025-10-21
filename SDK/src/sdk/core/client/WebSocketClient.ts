import { Logger } from "../utils/Logger";

export type WaitForPredicate<T> = (message: T) => boolean;

export type WsClientOptions = {
  maxLogPayloadLength?: number;
  redactKeys?: string[];
};

export class WsClient {
  private readonly url: string;
  private socket?: WebSocket;
  private readonly logger: Logger;
  private readonly options: Required<WsClientOptions>;

  private boundOnMessage?: (event: MessageEvent) => void;

  constructor(url: string, logger: Logger, options?: WsClientOptions) {
    this.url = url;
    this.logger = logger.child("WsClient");
    this.options = {
      maxLogPayloadLength: options?.maxLogPayloadLength ?? 2000,
      redactKeys: options?.redactKeys ?? [
        "token",
        "authorization",
        "auth",
        "secret",
        "card",
        "pan",
      ],
    };

    this.logger.debug("constructed", { url: this.url, options: this.options });
  }

  public async open(): Promise<void> {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      this.logger.debug("open() called but socket already open or connecting", {
        readyState: this.socket.readyState,
      });
      return;
    }

    const timer = this.logger.time("open");
    this.logger.info("opening", { url: this.url });

    this.socket = new WebSocket(this.url);

    return new Promise<void>((resolve, reject) => {
      if (!this.socket) {
        const error = new Error("WebSocket not initialised");
        this.logger.error("open: internal error", { message: error.message });
        timer.end({ error: error.message });
        reject(error);
        return;
      }

      const onOpen = () => {
        this.logger.info("opened");
        timer.end();
        cleanup();
        resolve();
      };

      const onError = (event: Event) => {
        const message = (event as any)?.message ?? "unknown";
        this.logger.error("error (during open)", { message });
        timer.end({ error: message });
        cleanup();
        reject(new Error(message));
      };

      const onClose = (event: CloseEvent) => {
        this.logger.warn("closed (during open)", {
          code: event.code,
          reason: event.reason,
        });
        timer.end({ code: event.code });
        cleanup();
        reject(new Error(`WebSocket closed during open (code ${event.code})`));
      };

      const cleanup = () => {
        if (!this.socket) {
          return;
        }
        this.socket.removeEventListener("open", onOpen);
        this.socket.removeEventListener("error", onError);
        this.socket.removeEventListener("close", onClose);
        if (this.boundOnMessage) {
          this.socket.removeEventListener("message", this.boundOnMessage);
        }
      };

      this.boundOnMessage =
        this.boundOnMessage ?? ((event: MessageEvent) => this.onMessage(event));
      this.socket.addEventListener("message", this.boundOnMessage);

      this.socket.addEventListener("open", onOpen);
      this.socket.addEventListener("error", onError);
      this.socket.addEventListener("close", onClose);
    });
  }

  public close(): void {
    if (!this.socket) {
      this.logger.debug("close: no socket");
      return;
    }

    this.logger.info("closing");
    try {
      this.socket.close();
    } catch (error) {
      this.logger.warn("close threw", { message: (error as Error)?.message });
    } finally {
      this.cleanupSocket();
      this.logger.info("closed");
    }
  }

  public send(data: string | object): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.logger.warn("send: socket not open");
      return;
    }

    const payload = typeof data === "string" ? data : JSON.stringify(data);
    this.logger.debug("send", this.previewPayload(payload));

    try {
      this.socket.send(payload);
    } catch (error) {
      this.logger.error("send failed", { message: (error as Error)?.message });
    }
  }

  public waitFor<T = any>(
  topic: string,
  predicate: WaitForPredicate<T>,
  timeoutMs: number,
): Promise<T> {
  if (!this.socket) {
    return Promise.reject(new Error("WebSocket not open"));
  }

  const socket = this.socket as WebSocket;
  const waiterLogger = this.logger.child("waitFor");
  const timer = waiterLogger.time(`wait:${topic}`);
  waiterLogger.info("waiting", { topic, timeoutMs });

  return new Promise<T>((resolve, reject) => {
    let resolved = false;

    const baseResolve = (value: T) => {
      if (!resolved) {
        resolved = true;
        timer.end({ outcome: "resolved" });
        waiterLogger.info("resolved", { topic });
        cleanup();
        resolve(value);
      }
    };

    const baseReject = (error: Error, meta?: Record<string, unknown>) => {
      if (!resolved) {
        resolved = true;
        timer.end({ outcome: "rejected", error: error.message });
        waiterLogger.warn("rejected", { topic, message: error.message, ...(meta ?? {}) });
        cleanup();
        reject(error);
      }
    };

    // We'll reassign these to add timeout clearing, but they will forward to the *base* versions
    let resolveOnce = baseResolve;
    let rejectOnce  = baseReject;

    const onMessage = (event: MessageEvent) => {
      const parsed = this.tryParse(event.data);
      const matches = safePredicateCall(predicate, parsed);

      waiterLogger.debug("consider message", {
        topic,
        matches,
        preview: this.previewPayload(event.data),
      });

      if (matches) {
        resolveOnce(parsed as T);
      }
    };

    const onClose = (event: CloseEvent) => {
      rejectOnce(new Error("WebSocket closed while waiting"), { code: event.code, reason: event.reason });
    };

    const onError = (event: Event) => {
      rejectOnce(new Error("WebSocket error while waiting"), { message: (event as any)?.message });
    };

    const cleanup = () => {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("error", onError);
    };

    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", onError);

    const timeoutId = window.setTimeout(() => {
      rejectOnce(new Error(`waitFor timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    // Reassign to wrappers that clear timeout then delegate to the *base* functions
    resolveOnce = (value: T) => {
      window.clearTimeout(timeoutId);
      baseResolve(value);
    };
    rejectOnce = (error: Error, meta?: Record<string, unknown>) => {
      window.clearTimeout(timeoutId);
      baseReject(error, meta);
    };
  });
}

  // ---------- internals ----------

  private onMessage(event: MessageEvent): void {
    this.logger.debug("message", this.previewPayload(event.data));
  }

  private cleanupSocket(): void {
    const socket = this.socket;
    if (!socket) {
      return;
    }

    try {
      if (this.boundOnMessage) {
        socket.removeEventListener("message", this.boundOnMessage);
      }
      socket.close();
    } catch {
      // ignore
    } finally {
      this.socket = undefined;
    }
  }

  private previewPayload(data: any): Record<string, unknown> {
    const parsed = this.tryParse(data);
    if (parsed && typeof parsed === "object") {
      return {
        json: this.redactDeep(parsed, new Set(this.options.redactKeys)),
      };
    }

    const text = typeof data === "string" ? data : String(data);
    return {
      text:
        text.length > this.options.maxLogPayloadLength
          ? text.slice(0, this.options.maxLogPayloadLength) + "…"
          : text,
    };
  }

  private tryParse(data: any): any {
    if (typeof data !== "string") {
      return data;
    }

    try {
      return JSON.parse(data);
    } catch {
        return data;
    }
  }

  private redactDeep(value: any, keysToRedact: Set<string>): any {
    if (Array.isArray(value)) {
      return value.map((v) => this.redactDeep(v, keysToRedact));
    }

    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        if (keysToRedact.has(key.toLowerCase())) {
          out[key] = "[REDACTED]";
        } else {
          out[key] = this.redactDeep(val, keysToRedact);
        }
      }
      return out;
    }

    return value;
  }
}

function safePredicateCall<T>(
  predicate: (message: T) => boolean,
  message: unknown,
): boolean {
  try {
    return predicate(message as T);
  } catch {
    return false;
  }
}
