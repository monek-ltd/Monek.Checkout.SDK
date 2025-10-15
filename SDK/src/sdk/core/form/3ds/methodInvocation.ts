import { WsClient } from '../../client/WebSocketClient';

export async function performThreeDSMethodInvocation(
    methodUrl?: string | null,
    methodData?: string | null,
    timeoutMs = 10000,
    ws?: WsClient,
    sessionId? : string
): Promise<'skipped' | 'performed' | 'timeout'> {

    if (!methodUrl || !methodData) {
        return 'skipped';
    }

    return new Promise(async (resolve) => {
        const iframe = document.createElement('iframe');
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        iframe.style.position = 'absolute';
        iframe.style.left = '-9999px';
        document.body.appendChild(iframe);

        const doc = iframe.contentWindow!.document;
        doc.open();
        doc.write(`
          <form id="threeDSMethodForm" action="${methodUrl}" method="POST">
            <input type="hidden" name="threeDSMethodData" value="${methodData}">
          </form>
          <script>document.getElementById('threeDSMethodForm').submit();</script>
        `);
        doc.close();

        const timeoutId = window.setTimeout(() => {
            cleanup();
            resolve('timeout');
        }, timeoutMs);

        // After timeout, assume method has had time to run (device info sent).
        function cleanup() {
            try { document.body.removeChild(iframe); } catch { }
        }

        if (ws && sessionId) {
            try {
                await ws.waitFor<{ type: string; sessionId: string; status: string }>(
                    '3ds.method.result',
                    m => m.sessionId === sessionId,
                    timeoutMs
                );

                window.clearTimeout(timeoutId);
                cleanup();
                resolve('performed');

                return;
            } catch {
                // resolve timeout
            }
        } else {
            // Heuristic fallback: assume performed after half timeout
            window.setTimeout(() => {
                window.clearTimeout(timeoutId);
                cleanup();
                resolve('performed');
            }, Math.min(6000, timeoutMs));
        }
    });
}