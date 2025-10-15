type WsJson = { type: string; sessionId?: string;[k: string]: any };

export class WsClient {
    private ws?: WebSocket;
    private openPromise?: Promise<void>;
    private listeners = new Set<(m: WsJson) => void>();
    private url: string;

    constructor(url: string) { this.url = url }

    open(): Promise<void> {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return Promise.resolve();
        }

        if (this.openPromise) {
            return this.openPromise;
        }

        this.openPromise = new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(this.url);
            this.ws = ws;

            const onOpen = () => {
                cleanup();
                resolve();
            };

            const onError = () => {
                cleanup();
                reject(new Error("WebSocket connection error"));
            };

            const onClose = () => {};
            const onMessage = (ev: MessageEvent) => {
                try {
                    const data = JSON.parse(ev.data);
                    this.listeners.forEach(fn => fn(data));
                } catch {}
            };

            const cleanup = () => {
                ws.removeEventListener("open", onOpen);
                ws.removeEventListener("error", onError);
                ws.removeEventListener("close", onClose);
                ws.removeEventListener("message", onMessage);
            };

            ws.addEventListener("open", onOpen);
            ws.addEventListener("error", onError);
            ws.addEventListener("close", onClose);
            ws.addEventListener("message", onMessage);
        });

        return this.openPromise;
    }

    close() {
        try {
            this.ws?.close();
        } catch { }

        this.ws = undefined;
        this.openPromise = undefined;
        this.listeners.clear();
    }

    /** Wait for a message that matches type + predicate; reject on timeout */
    waitFor<T extends WsJson>(
        type: string,
        predicate: (m: T) => boolean,
        timeoutMs: number
    ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            let done = false;
            const onMsg = (m: WsJson) => {
                if (done) {
                    return;
                }

                if (m?.type === type && predicate(m as T)) {
                    done = true;
                    this.listeners.delete(onMsg);
                    clearTimeout(t);
                    resolve(m as T);
                }
            };

            this.listeners.add(onMsg);

            const t = window.setTimeout(() => {
                if (done) {
                    return;
                }

                done = true;
                this.listeners.delete(onMsg);
                reject(new Error(`WebSocket waitFor timeout for "${type}"`));
            }, timeoutMs);
        });
    }
}
