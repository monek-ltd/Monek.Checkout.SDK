// core/pay/pay.ts
import { API } from '../../../config';
import type { CheckoutPort } from '../../../types/checkout-port';
import type { PaymentResponse } from './payment-payloads';
import { buildPaymentRequest } from './buildPaymentRequest';
import { mapPaymentResponse } from './mapPaymentResponse';

export type PayDeps = {
  fetchImpl?: typeof fetch;
  debugEnabled?: boolean;
};

export async function pay(
  cardTokenId: string,
  sessionId: string,
  expiry: string,
  component: CheckoutPort,
  deps: PayDeps = {}
): Promise<PaymentResponse>
{
  const fetchImpl = deps.fetchImpl ?? fetch;
  const debugEnabled = Boolean(deps.debugEnabled);

  const debug = (message: string, data?: unknown) =>
  {
    if (!debugEnabled)
    {
      return;
    }
    // eslint-disable-next-line no-console
    console.log('[Pay]', message, data ?? '');
  };

  debug('start', { sessionId });

  const requestBody = await buildPaymentRequest(cardTokenId, sessionId, expiry, component);
  debug('request built', requestBody);

  let response: Response;
  try
  {
    response = await fetchImpl(`${API.base}/payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': component.getPublicKey(),
      },
      body: JSON.stringify(requestBody),
    });
  }
  catch (networkError)
  {
    debug('network error', { message: (networkError as Error)?.message });
    throw new Error('Payment request failed to send');
  }

  if (!response.ok)
  {
    debug('non-OK response', { status: response.status });
    throw new Error(`payment failed (${response.status})`);
  }

  let rawJson: any;
  try
  {
    rawJson = await response.json();
  }
  catch
  {
    debug('invalid JSON response');
    throw new Error('Invalid payment response (not JSON)');
  }

  const payload = mapPaymentResponse(rawJson);
  debug('success', payload);

  return payload;
}
