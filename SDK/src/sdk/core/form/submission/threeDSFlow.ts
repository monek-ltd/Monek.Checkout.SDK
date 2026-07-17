import type { CheckoutPort } from '../../../types/checkout-port';
import type { ChallengeSize, ChallengeOptions } from '../../../types/challenge-window';
import type { WsClient } from '../../client/WebSocketClient';

import { getThreeDSMethodData } from '../3ds/panInformation';
import { performThreeDSMethodInvocation } from '../3ds/methodInvocation';
import { authenticate } from '../3ds/authenticate';
import { openChallengeWindow } from "../3ds/challenge";
import { TIMEOUT_THREEDS_METHOD_MS, TIMEOUT_CHALLENGE_MS } from './constants';
import { Logger } from '../../utils/Logger';

// The ACS transStatus letters carried by both the WS back-channel and the front-channel close.
const TERMINAL_TRANS_STATUSES = ['Y', 'N', 'U', 'A', 'R'];

function isTerminalTransStatus(status: unknown): boolean {
  return typeof status === 'string' && TERMINAL_TRANS_STATUSES.includes(status.toUpperCase());
}

// Maps an ACS transStatus letter to the SDK outcome. Y/A (authenticated / attempted, both carry
// liability shift) proceed; N/U/R and anything unknown fail conservatively → onError.
export function mapTransStatus(status: unknown): 'authenticated' | 'not-authenticated' {
  const normalised = typeof status === 'string' ? status.toUpperCase() : '';
  return normalised === 'Y' || normalised === 'A' ? 'authenticated' : 'not-authenticated';
}

type ChallengeResult =
  | { kind: 'closed' }
  | { kind: 'timeout' }
  | { kind: 'polled'; data: { status?: string; resultSummary?: string } };

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
  webSocketClient: WsClient | null,
  logger: Logger
): Promise<AuthContext> {
  const flowLogger = logger.child('ThreeDSFlow');
  flowLogger.info('start', { sessionId, hasWebSocket: Boolean(webSocketClient) });

  // 1) Get method data
  const timerGetData = flowLogger.time('getThreeDSMethodData');
  let threeDSData: any;
  try {
    threeDSData = await getThreeDSMethodData(component.getPublicKey(), cardTokenId, sessionId);
    timerGetData.end({ hasMethodUrl: Boolean(threeDSData?.threeDSRequest?.methodUrl) });
  }
  catch (error) {
    timerGetData.end({ error: (error as Error)?.message ?? String(error) });
    flowLogger.error('getThreeDSMethodData failed', { message: (error as Error)?.message });
    throw error;
  }

  // 2) Method invocation (best-effort + timeout)
  const methodUrl = threeDSData.threeDSRequest?.methodUrl;
  const methodData = threeDSData.threeDSRequest?.methodData;

  const timerMethod = flowLogger.time('performThreeDSMethodInvocation');
  try {
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
  catch (error) {
    // This is best-effort; we log but do not throw to preserve behaviour.
    timerMethod.end({ error: (error as Error)?.message ?? String(error) });
    flowLogger.warn('performThreeDSMethodInvocation failed (continuing)', {
      message: (error as Error)?.message
    });
  }

  // 3) Authenticate
  const timerAuth = flowLogger.time('authenticate');
  let authenticationResult: any;
  try {
    authenticationResult = await authenticate(
      component.getPublicKey(),
      cardTokenId,
      sessionId,
      component.getCallbacks(),
      expiry,
      component.getChallengeOptions().size ?? 'medium',
      component.getChallengeOptions().force ?? false,
      component.getParentOrigin()
    );
    timerAuth.end({ result: authenticationResult?.result });
  }
  catch (error) {
    timerAuth.end({ error: (error as Error)?.message ?? String(error) });
    flowLogger.error('authenticate failed', { message: (error as Error)?.message });
    throw error;
  }

  if (authenticationResult?.errorMessage) {
    flowLogger.error('authenticate returned errorMessage', { errorMessage: authenticationResult.errorMessage });
    throw new Error(`3DS authentication error: ${authenticationResult.errorMessage}`);
  }

  // --- Branches ---
  if (authenticationResult?.result === 'challenge') {
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

    if (challengeResult.kind === 'closed' || challengeResult.kind === 'timeout') {
      // User cancel or hard timeout: not an authentication failure. Return a distinct 'cancelled'
      // result and let submissionController dispatch onCancel/onClosed with the real helpers (a
      // single hook per attempt) rather than invoking it here with stub helpers.
      flowLogger.info('challenge cancelled', { kind: challengeResult.kind });
      authenticationResult.result = 'cancelled';
      const ctx: AuthContext = { sessionId, cardTokenId, expiry, authenticationResult };
      flowLogger.info('end', { outcome: challengeResult.kind });
      return ctx;
    }
    else {
      // Polled result carrying the real ACS transStatus (from the WS back-channel, or a
      // status-bearing front-channel close). Branch on the outcome instead of assuming success.
      const status = challengeResult.data?.status;
      const outcome = mapTransStatus(status);
      flowLogger.info('challenge polled result', { status, outcome, resultSummary: challengeResult.data?.resultSummary });

      authenticationResult.transStatus = status;
      authenticationResult.resultSummary = challengeResult.data?.resultSummary;

      if (outcome === 'not-authenticated') {
        authenticationResult.result = 'not-authenticated';
        const ctx: AuthContext = { sessionId, cardTokenId, expiry, authenticationResult };
        flowLogger.info('end', { outcome: 'not-authenticated (challenge)' });
        return ctx;
      }

      // authenticated → fall through to end
    }
  }
  else if (authenticationResult?.result === 'not-authenticated') {
    flowLogger.warn('not-authenticated from ACS');
    const ctx: AuthContext = { sessionId, cardTokenId, expiry, authenticationResult };
    flowLogger.info('end', { outcome: 'not-authenticated' });
    return ctx;
  }
  else {
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
): Promise<ChallengeResult> {
  const { done, close } = openChallengeWindow({
    acsUrl,
    creq,
    display,
    size,
    waitForResult: async () => {
      if (!webSocketClient) {
        logger.warn('3DS challenge: no WebSocket; using timeout fallback');
        await new Promise(resolve => setTimeout(resolve, TIMEOUT_CHALLENGE_MS));
        return { status: 'timeout' as const };
      }

      try {
        const event = await webSocketClient.waitFor<any>(
          '3ds.challenge.result',
          (received: any) => {
            // Match any terminal ACS status (Y/N/U/A/R), not just success — the caller branches
            // on the real status, so a failed challenge must resolve here rather than time out.
            const matches =
              received &&
              typeof received === 'object' &&
              received.type === '3ds.challenge.result' &&
              isTerminalTransStatus(received.status);

            if (matches) {
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

        return { status: event?.status ?? 'unknown', resultSummary: event?.resultSummary };
      }
      catch (error) {
        logger.warn('3DS challenge: WS wait failed; treating as timeout', { message: (error as Error)?.message });
        return { status: 'timeout' as const };
      }
    },
  } as ChallengeOptions, logger);

  const result = await done;
  close();

  if (result.kind === 'closed') {
    logger.info('3DS challenge: user closed challenge window');
    return { kind: 'closed' };
  }

  if (result.kind === 'timeout') {
    logger.warn('3DS challenge: timed out');
    return { kind: 'timeout' };
  }

  logger.debug('3DS challenge: polled/received data', { data: result.data });
  return { kind: 'polled', data: result.data };
}
