import { WsClient } from '../../client/WebSocketClient';
import { WS } from '../../../config';

export async function openSessionWebSocket(sessionId: string): Promise<WsClient | null>
{
  const url = `${WS.base}?sessionId=${encodeURIComponent(sessionId)}`;
  const webSocketClient = new WsClient(url);

  try
  {
    await webSocketClient.open();
    return webSocketClient;
  }
  catch
  {
    // eslint-disable-next-line no-console
    console.warn('[WS] failed to connect; proceeding with timeouts only');
    return null;
  }
}
