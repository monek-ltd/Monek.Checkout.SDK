import type { CheckoutPort } from '../../types/checkout-port';
import { buildCompletionHelpers } from "./submission/buildCompletionHelpers";
import { openSessionWebSocket } from "./submission/openSessionWebSocket";
import { tokeniseAndGetExpiry } from "./submission/requestToken";
import { runThreeDSFlow } from "./submission/threeDSFlow";
import { completeSubmission } from "./submission/completeSubmission";
import { runCompletionHook } from './helpers/runCompletionHook';

export function interceptFormSubmit(
  form: HTMLFormElement,
  component: CheckoutPort,
  debugEnabled: boolean = false
)
{
  let isSubmitting = false;

  const debug = (message: string, data?: unknown) =>
  {
    if (!debugEnabled)
    {
      return;
    }
    // eslint-disable-next-line no-console
    console.log(`[Submit] ${message}`, data ?? '');
  };

  const onSubmit = async (event: SubmitEvent) =>
  {
    if (isSubmitting)
    {
      debug('blocked: already submitting');
      event.preventDefault();
      return;
    }

    isSubmitting = true;
    event.preventDefault();
    debug('start');

    const completionOptions = component.getCompletionOptions();
    const helpers = buildCompletionHelpers(form);
    helpers.disable();

    let webSocketClient: any | null = null;

    try
    {
      const sessionId = component.getSessionId();
      if (!sessionId)
      {
        throw new Error('Missing SessionID');
      }
      debug('session acquired', { sessionId });

      webSocketClient = await openSessionWebSocket(sessionId);
      debug('websocket initialised', { connected: Boolean(webSocketClient) });

      const { cardTokenId, expiry } = await tokeniseAndGetExpiry(component);
      debug('tokenised', { cardTokenId, expiry });

      const authContext = await runThreeDSFlow(
        component,
        sessionId,
        cardTokenId,
        expiry,
        completionOptions,
        webSocketClient
      );
      debug('3DS flow complete', { result: authContext.authenticationResult?.result });

      // Not-authenticated branch
      if (authContext.authenticationResult?.result === 'not-authenticated')
      {
        debug('not-authenticated branch entered');

        if (completionOptions?.onError)
        {
          await runCompletionHook(
            completionOptions.onError,
            { sessionId, cardTokenId, auth: authContext.authenticationResult, payment: null },
            helpers
          );
          debug('completion onError hook executed');
        }
        else
        {
          throw new Error(`Authentication error: ${authContext.authenticationResult?.result}`);
        }
        return;
      }

      debug('proceeding to completion', { mode: completionOptions?.mode ?? 'server' });

      await completeSubmission(
        form,
        component,
        completionOptions,
        { sessionId, cardTokenId, expiry, auth: authContext.authenticationResult },
        helpers
      );

      debug('completion finished');
    }
    catch (error)
    {
      // eslint-disable-next-line no-console
      console.error('[Checkout] error:', error);
      debug('error caught', { message: (error as Error)?.message });
    }
    finally
    {
      helpers.reenable();
      isSubmitting = false;

      try
      {
        webSocketClient?.close();
        debug('websocket closed');
      }
      catch
      {
        debug('websocket close failed (ignored)');
      }

      debug('end');
    }
  };

  form.addEventListener('submit', onSubmit, { capture: true });
  return () => form.removeEventListener('submit', onSubmit, { capture: true } as any);
}
