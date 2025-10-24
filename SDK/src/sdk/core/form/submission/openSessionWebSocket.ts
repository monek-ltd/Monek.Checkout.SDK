import { WsClient } from '../../client/WebSocketClient';
import { WS } from '../../../config';
import { Logger } from '../../utils/Logger';

export async function openSessionWebSocket(sessionId: string, logger: Logger): Promise<WsClient | null>
{
  const url = `${WS.base}?sessionId=${encodeURIComponent(sessionId)}`;
  const wsLogger = logger.child('WS');
  const timer = wsLogger.time('open');

  wsLogger.info('connecting', { url, sessionId });

  const webSocketClient = new WsClient(url, wsLogger);

  try
  {
    await webSocketClient.open();
    timer.end({ connected: true });
    wsLogger.info('connected');
    return webSocketClient;
  }
  catch (error)
  {
    timer.end({ connected: false, error: (error as Error)?.message });
    wsLogger.warn('failed to connect; proceeding with timeouts only', {
      message: (error as Error)?.message
    });
    return null;
  }
}
