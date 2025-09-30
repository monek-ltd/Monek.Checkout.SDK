import type { CheckoutComponent } from "../lib/CheckoutComponent";
import type { CompletionHelpers } from "../types/completion";
import { getThreeDSMethodData } from '../core/3ds/panInformation';
import { performThreeDSMethodInvocation } from '../core/3ds/methodInvocation';
import { authenticate } from '../core/3ds/authenticate';
import { challenge } from "../core/3ds/challenge";
import { normalisePayment } from '../core/pay/normalise';
import { performRedirect, attachHidden } from '../core/utils/redirect';
import { pay } from '../core/pay/pay';
import { runCompletionHook } from './utils/runCompletionHook';
import { WsClient } from './utils/ws'

export function interceptFormSubmit(
    form: HTMLFormElement,
    component: CheckoutComponent
) {
    let busy = false;

    const onSubmit = async (e: SubmitEvent) => {
        if (busy) { e.preventDefault(); return; }
        busy = true;
        e.preventDefault();

        const submitButtons = form.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input[type=button], input[type=submit]');
        submitButtons.forEach(b => b.disabled = true);

        const helpers = {
            redirect: performRedirect,
            submitForm: (fields?: Record<string, string>) => {
                if (fields) {
                    Object.entries(fields).forEach(([key, value]) => attachHidden(form, key, value));
                }
                form.submit();
            },
            reenable: () => submitButtons.forEach(b => b.disabled = false),
            disable: () => submitButtons.forEach(b => b.disabled = true),
        } as CompletionHelpers;

        let ws: WsClient | null = null;

        try {
            helpers.disable();
            const completionOptions = component.getCompletionOptions();

            const sessionId = component.getSessionId();
            if (!sessionId) throw new Error('Missing SessionID');

            // --- open WebSocket tied to this session ---
            // Example URL shape; include any auth/token as needed
            ws = new WsClient(`wss://5pqu90u40l.execute-api.eu-west-2.amazonaws.com/v1?sessionId=${encodeURIComponent(sessionId)}`);
            try {
                await ws.open();
            } catch {
                // If socket fails, we still proceed with timeouts/fallbacks
                console.warn('[WS] failed to connect; proceeding with timeouts only');
            }

            // 1) tokenise (iframe → token endpoint)
            const cardTokenId = await component.requestToken();
            const expiry = await component.requestExpiry();

            // 2) start 3DS
            const threeDS = await getThreeDSMethodData(component.getPublicKey(), cardTokenId, sessionId);

            // 3) Run 3DS Method (if provided)
            await performThreeDSMethodInvocation(
                threeDS.threeDSRequest.methodUrl,
                threeDS.threeDSRequest.methodData,
                10000,
                ws,
                sessionId
            );

            // 4) Call 3DS Authentication
            const authenticationResult = await authenticate(
                component.getPublicKey(), 
                cardTokenId, 
                sessionId, 
                component.getCallbacks()!, 
                expiry, 
                component.getChallengeOptions().size ?? 'medium')

            if (authenticationResult.errorMessage) {
                throw new Error(`3DS authentication error: ${authenticationResult.errorMessage}`);
            }
            console.log('3DS authentication result:', authenticationResult);

            // 4a) If challenge required, run challenge flow
            if(authenticationResult.result === 'challenge') {
                const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
                const display = component.getChallengeOptions().display ?? 'popup';
                const size = component.getChallengeOptions().size ?? 'medium';

                const { done, close } = challenge({
                    acsUrl: authenticationResult.challenge?.acsUrl ?? '',
                    creq:   authenticationResult.challenge?.cReq ?? '',

                    waitForResult: async () => {
                        // race: websocket event OR manual timeout if ws not available
                        const TIMEOUT_MS = 120_000; // e.g. 2 minutes
                        if (!ws) {
                            // fallback if socket didn’t open
                            await new Promise(r => setTimeout(r, TIMEOUT_MS));
                            return { status: 'timeout' as const };
                        }
                        try {
                            const ev = await ws.waitFor<{ type: string; sessionId: string; status: string; data?: any }>(
                                '3ds.challenge.result',
                                m => m.sessionId === sessionId,
                                TIMEOUT_MS
                            );
                            return { status: ev.status, data: ev.data };
                        } catch {
                            return { status: 'timeout' as const };
                        }
                    },

                    display,
                    size,
                });

                const result = await done;           // { kind:'polled', data:{status:'mock-complete'} }
                close();
                console.log('[3DS] mock result:', result);
              
                if (result.kind === 'closed') {
                    if (completionOptions?.onClosed || completionOptions?.onCancel) {
                        await runCompletionHook(completionOptions?.onClosed ?? completionOptions?.onCancel, { sessionId, cardTokenId, auth: authenticationResult, payment: null }, helpers);
                    }
                    else {
                        throw new Error('Challenge closed by user');
                    }
                }
                else if (result.kind === 'timeout') {
                    if (completionOptions?.onCancel) {
                        await runCompletionHook(completionOptions?.onCancel, { sessionId, cardTokenId, auth: authenticationResult, payment: null }, helpers);
                    }
                    else {
                        throw new Error('Challenge timed out');
                    }
                }
                else {
                    // result.kind === 'polled' (our waitForResult returned a value)
                    // we could validate result.data
                    console.log(result.data);
                }
            }
            // 4b) If not authenticated, do something
            else if (authenticationResult.result === 'not-authenticated') {
                if (completionOptions?.onError) {
                    await runCompletionHook(completionOptions?.onError, { sessionId, cardTokenId, auth: authenticationResult, payment: null }, helpers);
                }
                else {
                    throw new Error(`Authentication error: ${authenticationResult.result}`);
                }
            }

            // 5) either pay or attach & submit
            if (completionOptions?.mode == 'client') {
                // 5a) pay
                const paymentResult = await pay(
                    cardTokenId,
                    sessionId,
                    expiry,
                    component
                )

                // 5b) redirect to success or failure url
                const normalisedPaymentResponse = normalisePayment(paymentResult);
                const ctx = { sessionId, cardTokenId, auth: authenticationResult, payment: paymentResult };

                if (normalisedPaymentResponse.status == 'approved') {
                    if (completionOptions?.onSuccess) {
                        await runCompletionHook(completionOptions?.onSuccess, ctx, helpers);
                    }
                    else {
                        throw new Error('Payment approved but no onSuccess handler');
                    }
                }
                else {
                    if (completionOptions?.onError) {
                        await runCompletionHook(completionOptions?.onError, ctx, helpers);
                    }
                    else {
                        throw new Error(`Payment error: ${normalisedPaymentResponse.reason}`);
                    }
                }
            }
            else {
                // 5c) attach results & submit
                attachHidden(form, 'CardTokenID', cardTokenId);
                attachHidden(form, 'SessionID', sessionId);

                form.submit();
            }
        } catch (err) {
            console.error('[Checkout] error:', err);
            helpers.disable();
            busy = false;
        }
    };

    form.addEventListener('submit', onSubmit, { capture: true });
    return () => form.removeEventListener('submit', onSubmit, { capture: true } as any);
}