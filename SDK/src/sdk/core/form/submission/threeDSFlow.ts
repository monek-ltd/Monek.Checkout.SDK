import type { CheckoutPort } from '../../../types/checkout-port';
import type { CompletionOptions } from "../../../types/completion";
import type { ChallengeSize, ChallengeOptions } from '../../../types/challenge-window'
import type { WsClient } from '../../client/WebSocketClient';

import { getThreeDSMethodData } from '../3ds/panInformation';
import { performThreeDSMethodInvocation } from '../3ds/methodInvocation';
import { authenticate } from '../3ds/authenticate';
import { openChallengeWindow } from "../3ds/challenge";
import { runCompletionHook } from '../helpers/runCompletionHook';
import { TIMEOUT_THREEDS_METHOD_MS, TIMEOUT_CHALLENGE_MS } from './constants';

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
  webSocketClient: WsClient | null
): Promise<AuthContext>
{
  // 1) Get method data
  const threeDSData = await getThreeDSMethodData(component.getPublicKey(), cardTokenId, sessionId);

  // 2) Method invocation (best-effort + timeout)
  await performThreeDSMethodInvocation(
    threeDSData.threeDSRequest.methodUrl,
    threeDSData.threeDSRequest.methodData,
    TIMEOUT_THREEDS_METHOD_MS,
    webSocketClient!,
    sessionId
  );

  // 3) Authenticate
  const authenticationResult = await authenticate(
    component.getPublicKey(),
    cardTokenId,
    sessionId,
    component.getCallbacks(),
    expiry,
    component.getChallengeOptions().size ?? 'medium',
    await component.getSourceIp()
  );

  if (authenticationResult.errorMessage)
  {
    throw new Error(`3DS authentication error: ${authenticationResult.errorMessage}`);
  }

  // Challenge branch
  if (authenticationResult.result === 'challenge')
  {
    const challengeResult = await performChallenge(
      sessionId,
      webSocketClient,
      authenticationResult.challenge?.acsUrl ?? '',
      authenticationResult.challenge?.cReq ?? '',
      component.getChallengeOptions().display ?? 'popup',
      component.getChallengeOptions().size ?? 'medium'
    );

    if (challengeResult.kind === 'closed')
    {
      if (completionOptions?.onClosed || completionOptions?.onCancel)
      {
        await runCompletionHook(
          completionOptions.onClosed ?? completionOptions.onCancel,
          { sessionId, cardTokenId, auth: authenticationResult, payment: null },
          // helpers are passed by caller
          // we keep API here pure and return control to caller
          // caller will supply helpers to runCompletionHook
          // we only assemble data here
          // no-op helpers here
          { redirect: () => undefined, submitForm: () => undefined, reenable: () => undefined, disable: () => undefined }
        );
      }
      else
      {
        throw new Error('Challenge closed by user');
      }
    }
    else if (challengeResult.kind === 'timeout')
    {
      if (completionOptions?.onCancel)
      {
        await runCompletionHook(
          completionOptions.onCancel,
          { sessionId, cardTokenId, auth: authenticationResult, payment: null },
          { redirect: () => undefined, submitForm: () => undefined, reenable: () => undefined, disable: () => undefined }
        );
      }
      else
      {
        throw new Error('Challenge timed out');
      }
    }
    else
    {
      // polled — keep behaviour (logging handled by caller previously)
      // no validation added to preserve behaviour
      // eslint-disable-next-line no-console
      console.log('[3DS] polled result:', challengeResult.data);
    }
  }
  else if (authenticationResult.result === 'not-authenticated')
  {
    // upstream decides next step (caller will run completion hook or throw)
    return { sessionId, cardTokenId, expiry, authenticationResult };
  }

  return { sessionId, cardTokenId, expiry, authenticationResult };
}

async function performChallenge(
  sessionId: string,
  webSocketClient: WsClient | null,
  acsUrl: string,
  creq: string,
  display: 'popup' | 'embedded' | string,
  size: ChallengeSize | string
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
        await new Promise(resolve => setTimeout(resolve, TIMEOUT_CHALLENGE_MS));
        return { status: 'timeout' as const };
      }

      try
      {
        const event = await webSocketClient.waitFor<{ type: string; sessionId: string; status: string; data?: unknown }>(
          '3ds.challenge.result',
          (received: any) => received.sessionId === sessionId,
          TIMEOUT_CHALLENGE_MS
        );
        return { status: event.status, data: event.data };
      }
      catch
      {
        return { status: 'timeout' as const };
      }
    },
  } as ChallengeOptions);

  const result = await done;
  close();

  if (result.kind === 'closed')
  {
    return { kind: 'closed' };
  }
  if (result.kind === 'timeout')
  {
    return { kind: 'timeout' };
  }
  return { kind: 'polled', data: result.data };
}
