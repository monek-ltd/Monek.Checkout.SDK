import type { CheckoutPort } from '../../../types/checkout-port';
import type { CompletionOptions } from "../../../types/completion";
import type { ChallengeSize, ChallengeOptions } from '../../../types/challenge-window';
import type { WsClient } from '../../client/WebSocketClient';

import { getThreeDSMethodData } from '../3ds/panInformation';
import { performThreeDSMethodInvocation } from '../3ds/methodInvocation';
import { authenticate } from '../3ds/authenticate';
import { openChallengeWindow } from "../3ds/challenge";
import { runCompletionHook } from '../helpers/runCompletionHook';
import { TIMEOUT_THREEDS_METHOD_MS, TIMEOUT_CHALLENGE_MS } from './constants';
import { Logger } from '../../utils/Logger';

type ChallengeResult =
  | { kind: 'closed' }
  | { kind: 'timeout' }
  | { kind: 'polled'; data: unknown };

export type AuthContext = {
  sessionId: string;
  cardTokenId: string;
  expiry: string;
  authenticationResult: any;
};

export async function runThreeDSFlow(
  component: CheckoutPort,
  sessionId: string,
  cardTokenId: string,
  expiry: string,
  completionOptions: CompletionOptions | undefined,
  webSocketClient: WsClient | null,
  logger: Logger
): Promise<AuthContext>
{
  const flowLogger = logger.child('ThreeDSFlow');
  flowLogger.info('start', { sessionId, hasWebSocket: Boolean(webSocketClient) });

  // 1) Get method data
  const timerGetData = flowLogger.time('getThreeDSMethodData');
  let threeDSData: any;
  try
  {
    threeDSData = await getThreeDSMethodData(component.getPublicKey(), cardTokenId, sessionId);
    timerGetData.end({ hasMethodUrl: Boolean(threeDSData?.threeDSRequest?.methodUrl) });
  }
  catch (error)
  {
    timerGetData.end({ error: (error as Error)?.message ?? String(error) });
    flowLogger.error('getThreeDSMethodData failed', { message: (error as Error)?.message });
    throw error;
  }

  // 2) Method invocation (best-effort + timeout)
  const methodUrl = threeDSData.threeDSRequest?.methodUrl;
  const methodData = threeDSData.threeDSRequest?.methodData;

  const timerMethod = flowLogger.time('performThreeDSMethodInvocation');
  try
  {
    await performThreeDSMethodInvocation(
      methodUrl,
      methodData,
      TIMEOUT_THREEDS_METHOD_MS,
      webSocketClient!,
      sessionId,
      flowLogger.child('Method')
    );
    timerMethod.end({ invoked: Boolean(methodUrl && methodData) });
  }
  catch (error)
  {
    // This is best-effort; we log but do not throw to preserve behaviour.
    timerMethod.end({ error: (error as Error)?.message ?? String(error) });
    flowLogger.warn('performThreeDSMethodInvocation failed (continuing)', {
      message: (error as Error)?.message
    });
  }

  // 3) Authenticate
  const timerAuth = flowLogger.time('authenticate');
  let authenticationResult: any;
  try
  {
    authenticationResult = await authenticate(
      component.getPublicKey(),
      cardTokenId,
      sessionId,
      component.getCallbacks(),
      expiry,
      component.getChallengeOptions().size ?? 'medium',
      await component.getSourceIp(),
      component.getChallengeOptions().force ?? false
    );
    timerAuth.end({ result: authenticationResult?.result });
  }
  catch (error)
  {
    timerAuth.end({ error: (error as Error)?.message ?? String(error) });
    flowLogger.error('authenticate failed', { message: (error as Error)?.message });
    throw error;
  }

  if (authenticationResult?.errorMessage)
  {
    flowLogger.error('authenticate returned errorMessage', { errorMessage: authenticationResult.errorMessage });
    throw new Error(`3DS authentication error: ${authenticationResult.errorMessage}`);
  }

  // --- Branches ---
  if (authenticationResult?.result === 'challenge')
  {
    flowLogger.info('challenge required', {
      display: component.getChallengeOptions().display ?? 'popup',
      size: component.getChallengeOptions().size ?? 'medium'
    });

    const timerChallenge = flowLogger.time('challenge');
    const challengeResult = await performChallenge(
      sessionId,
      webSocketClient,
      authenticationResult.challenge?.acsUrl ?? '',
      authenticationResult.challenge?.cReq ?? '',
      component.getChallengeOptions().display ?? 'popup',
      component.getChallengeOptions().size ?? 'medium',
      flowLogger.child('Challenge')
    );
    timerChallenge.end({ kind: challengeResult.kind });

    if (challengeResult.kind === 'closed')
    {
      flowLogger.info('challenge closed by user');

      if (completionOptions?.onClosed || completionOptions?.onCancel)
      {
        flowLogger.debug('invoking completion: onClosed/onCancel');
        await runCompletionHook(
          completionOptions.onClosed ?? completionOptions.onCancel,
          { sessionId, cardTokenId, auth: challengeResult, payment: null },
          // helpers are passed by caller
          // we keep API here pure and return control to caller
          // caller will supply helpers to runCompletionHook
          // we only assemble data here
          // no-op helpers here
          { redirect: () => undefined, submitForm: () => undefined, reenable: () => undefined, disable: () => undefined }
        );
        
        authenticationResult.result = 'not-authenticated';
        const ctx: AuthContext = { sessionId, cardTokenId, expiry, authenticationResult };
        flowLogger.info('end', { outcome: 'closed' });
        return ctx;

      }
      else
      {
        flowLogger.warn('no completion handler for challenge closed; throwing');
        throw new Error('Challenge closed by user');
      }
    }
    else if (challengeResult.kind === 'timeout')
    {
      flowLogger.warn('challenge timed out');

      if (completionOptions?.onCancel)
      {
        flowLogger.debug('invoking completion: onCancel (timeout)');

        await runCompletionHook(
          completionOptions.onCancel,
          { sessionId, cardTokenId, auth: challengeResult, payment: null },
          { redirect: () => undefined, submitForm: () => undefined, reenable: () => undefined, disable: () => undefined }
        );
        
        authenticationResult.result = 'not-authenticated';
        const ctx: AuthContext = { sessionId, cardTokenId, expiry, authenticationResult };
        flowLogger.info('end', { outcome: 'time-out' });
        return ctx;
      }
      else
      {
        flowLogger.warn('no completion handler for timeout; throwing');
        throw new Error('Challenge timed out');
      }
    }
    else
    {
      flowLogger.info('challenge polled result', { data: challengeResult.data });

      //Fall through to end
    }
  }
  else if (authenticationResult?.result === 'not-authenticated')
  {
    flowLogger.warn('not-authenticated from ACS');
    const ctx: AuthContext = { sessionId, cardTokenId, expiry, authenticationResult };
    flowLogger.info('end', { outcome: 'not-authenticated' });
    return ctx;
  }
  else
  {
    flowLogger.info('no challenge required', { result: authenticationResult?.result });
  }

  authenticationResult.result = 'authenticated';
  const context: AuthContext = { sessionId, cardTokenId, expiry, authenticationResult };
  flowLogger.info('end', { outcome: 'ok' });
  return context;
}

async function performChallenge(
  sessionId: string,
  webSocketClient: WsClient | null,
  acsUrl: string,
  creq: string,
  display: 'popup' | 'embedded' | string,
  size: ChallengeSize | string,
  logger: Logger
): Promise<ChallengeResult>
{
  const { done, close } = openChallengeWindow({
    acsUrl,
    creq,
    display,
    size,
    waitForResult: async () =>
    {
      if (!webSocketClient)
      {
        logger.warn('3DS challenge: no WebSocket; using timeout fallback');
        await new Promise(resolve => setTimeout(resolve, TIMEOUT_CHALLENGE_MS));
        return { status: 'timeout' as const };
      }

      try
      {
        const event = await webSocketClient.waitFor<any>(
          '3ds.challenge.result',
          (received: any) =>
          {
            const matches =
              received &&
              typeof received === 'object' &&
              received.type === '3ds.challenge.result' &&
              received.status === 'Y';

            if (matches)
            {
              logger.info('3DS challenge: WS match', {
                sessionId,
                status: received.status ?? 'unknown',
                resultSummary: received.resultSummary ?? 'unknown'
              });
            }

            return matches;
          },
          TIMEOUT_CHALLENGE_MS
        );

        return { status: event?.status ?? 'unknown', data: { resultSummary: event?.resultSummary } };
      }
      catch (error)
      {
        logger.warn('3DS challenge: WS wait failed; treating as timeout', { message: (error as Error)?.message });
        return { status: 'timeout' as const };
      }
    },
  } as ChallengeOptions);

  const result = await done;
  close();

  if (result.kind === 'closed')
  {
    logger.info('3DS challenge: user closed challenge window');
    return { kind: 'closed' };
  }

  if (result.kind === 'timeout')
  {
    logger.warn('3DS challenge: timed out');
    return { kind: 'timeout' };
  }

  logger.debug('3DS challenge: polled/received data', { data: result.data });
  return { kind: 'polled', data: result.data };
}
