import { WsClient } from '../../client/WebSocketClient';
import { Logger } from '../../utils/Logger';

export async function performThreeDSMethodInvocation(
  methodUrl?: string | null,
  methodData?: string | null,
  timeoutMs = 10000,
  webSocketClient?: WsClient,
  sessionId?: string,     
  logger?: Logger
): Promise<'skipped' | 'performed' | 'timeout'>
{
  if (!methodUrl || !methodData)
  {
    logger?.debug('3DS method: skipped (no methodUrl/methodData)');
    return 'skipped';
  }

  logger?.info('3DS method: starting', { methodUrl, timeoutMs });

  return new Promise(async (resolve) =>
  {
    const iframe = document.createElement('iframe');
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.position = 'absolute';
    iframe.style.left = '-9999px';
    document.body.appendChild(iframe);

    const iframeDocument = iframe.contentWindow!.document;
    iframeDocument.open();
    iframeDocument.write(`
      <form id="threeDSMethodForm" action="${methodUrl}" method="POST">
        <input type="hidden" name="threeDSMethodData" value="${methodData}">
      </form>
      <script>document.getElementById('threeDSMethodForm').submit();</script>
    `);
    iframeDocument.close();

    const cleanup = () =>
    {
      try { document.body.removeChild(iframe); } catch { /* ignore */ }
    };

    const timeoutId = window.setTimeout(() =>
    {
      logger?.warn('3DS method: timeout');
      cleanup();
      resolve('timeout');
    }, timeoutMs);

    if (webSocketClient)
    {
      try
      {
        const event = await webSocketClient.waitFor<any>(
          '3ds.method.result',
          (received: any) =>
          {
            const matches =
              received &&
              typeof received === 'object' &&
              received.type === '3ds.method.result';

            if (matches)
            {
              logger?.debug('3DS method: WS match', {
                sessionId,
                methodCompletion: received.methodCompletion ?? 'unknown'
              });
            }

            return matches;
          },
          timeoutMs
        );

        window.clearTimeout(timeoutId);
        cleanup();
        logger?.info('3DS method: performed', { methodCompletion: event?.methodCompletion });
        resolve('performed');
        return;
      }
      catch (error)
      {
        logger?.warn('3DS method: WS wait failed; falling back to heuristic', { message: (error as Error)?.message });
      }
    }

    window.setTimeout(() =>
    {
      window.clearTimeout(timeoutId);
      cleanup();
      logger?.info('3DS method: heuristic performed');
      resolve('performed');
    }, Math.min(6000, timeoutMs));
  });
}
