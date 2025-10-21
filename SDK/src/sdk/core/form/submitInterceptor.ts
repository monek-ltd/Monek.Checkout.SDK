import type { CheckoutPort } from '../../types/checkout-port';
import { buildCompletionHelpers } from "./submission/buildCompletionHelpers";
import { openSessionWebSocket } from "./submission/openSessionWebSocket";
import { tokeniseAndGetExpiry } from "./submission/requestToken";
import { runThreeDSFlow } from "./submission/threeDSFlow";
import { completeSubmission } from "./submission/completeSubmission";
import { runCompletionHook } from './helpers/runCompletionHook';
import { Logger } from '../utils/Logger';

export function interceptFormSubmit(
  form: HTMLFormElement,
  component: CheckoutPort,
  logger: Logger
)
{
  const submitLogger = logger.child('Submit');
  let isSubmitting = false;

  const debug = (message: string, data?: unknown) =>
  {
    submitLogger.debug(message, data ?? undefined);
  };

  const onSubmit = async (event: SubmitEvent) =>
  {
    if (isSubmitting)
    {
      event.preventDefault();
      debug('blocked: already submitting');
      return;
    }

    isSubmitting = true;
    event.preventDefault();

    submitLogger.info('start');
    const timerOverall = submitLogger.time('overall');

    const completionOptions = component.getCompletionOptions();
    const helpers = buildCompletionHelpers(form);
    helpers.disable();
    debug('helpers disabled');

    let webSocketClient: any | null = null;

    try
    {
      const sessionId = component.getSessionId();
      if (!sessionId)
      {
        throw new Error('Missing SessionID');
      }
      debug('session acquired', { sessionId });

      // WebSocket
      const timerWs = submitLogger.time('websocket');
      try
      {
        webSocketClient = await openSessionWebSocket(sessionId, submitLogger.child("WebSocket"));
        timerWs.end({ connected: Boolean(webSocketClient) });
        debug('websocket initialised', { connected: Boolean(webSocketClient) });
      }
      catch (wsError)
      {
        timerWs.end({ error: (wsError as Error)?.message });
        submitLogger.warn('websocket failed to open; continuing without it', { message: (wsError as Error)?.message });
      }

      // Tokenise + expiry
      const timerTokenise = submitLogger.time('tokenise');
      const { cardTokenId, expiry } = await tokeniseAndGetExpiry(component);
      timerTokenise.end();
      debug('tokenised', { cardTokenId, expiry });

      // 3DS flow
      const timer3ds = submitLogger.time('3ds');
      const authContext = await runThreeDSFlow(
        component,
        sessionId,
        cardTokenId,
        expiry,
        completionOptions,
        webSocketClient,
        submitLogger.child('ThreeDS')
      );
      timer3ds.end({ result: authContext.authenticationResult?.result });
      debug('3DS flow complete', { result: authContext.authenticationResult?.result });

      // Not-authenticated branch
      if (authContext.authenticationResult?.result === 'not-authenticated')
      {
        submitLogger.warn('not-authenticated; invoking onError if provided');

        if (completionOptions?.onError)
        {
          const timerHook = submitLogger.time('completion:onError');
          await runCompletionHook(
            completionOptions.onError,
            { sessionId, cardTokenId, auth: authContext.authenticationResult, payment: null },
            helpers
          );
          timerHook.end();
          debug('completion onError hook executed');
        }
        else
        {
          throw new Error(`Authentication error: ${authContext.authenticationResult?.result}`);
        }
        return;
      }

      // Completion (client/server)
      submitLogger.info('proceeding to completion', { mode: completionOptions?.mode ?? 'server' });
      const timerComplete = submitLogger.time('completeSubmission');

      await completeSubmission(
        form,
        component,
        completionOptions,
        { sessionId, cardTokenId, expiry, auth: authContext.authenticationResult },
        helpers
      );

      timerComplete.end();
      debug('completion finished');
    }
    catch (error)
    {
      submitLogger.error('submission error', { message: (error as Error)?.message });
      debug('error caught', { message: (error as Error)?.message });
    }
    finally
    {
      try
      {
        helpers.reenable();
        debug('helpers reenabled');
      }
      catch
      {
        submitLogger.warn('helpers.reenable threw (ignored)');
      }

      isSubmitting = false;

      try
      {
        webSocketClient?.close();
        debug('websocket closed');
      }
      catch
      {
        debug('websocket close failed (ignored)');
        submitLogger.warn('websocket close failed (ignored)');
      }

      timerOverall.end();
      submitLogger.info('end');
    }
  };

  form.addEventListener('submit', onSubmit, { capture: true });
  submitLogger.debug('listener attached');

  return () =>
  {
    form.removeEventListener('submit', onSubmit, { capture: true } as any);
    submitLogger.debug('listener removed');
  };
}
