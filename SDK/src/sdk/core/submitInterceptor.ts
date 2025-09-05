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

        try {
            helpers.disable();
            const completionOptions = component.getCompletionOptions();

            const sessionId = component.getSessionId();
            if (!sessionId) throw new Error('Missing SessionID');

            // 1) tokenise (iframe → token endpoint)
            const cardTokenId = await component.requestToken();
            const expiry = await component.requestExpiry();

            // 2) start 3DS
            const threeDS = await getThreeDSMethodData(component.getPublicKey(), cardTokenId, sessionId);

            // 3) Run 3DS Method (if provided)
            await performThreeDSMethodInvocation(
                threeDS.threeDSRequest.methodUrl,
                threeDS.threeDSRequest.methodData,
                10000
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
                        await sleep(60_000);             // fake poller
                        return { status: 'mock-complete' };
                    },

                    display,
                    size,
                });

                const result = await done;           // { kind:'polled', data:{status:'mock-complete'} }
                close();
                console.log('[3DS] mock result:', result);
              
                if (result.kind === 'closed') {
                    if (completionOptions?.onCancel) {
                        await runCompletionHook(completionOptions?.onCancel, { sessionId, cardTokenId, auth: authenticationResult, payment: null }, helpers);
                    }
                    else {
                        throw new Error('Challenge closed by user');
                    }
                }
                if (result.kind === 'timeout') {
                    if (completionOptions?.onCancel) {
                        await runCompletionHook(completionOptions?.onCancel, { sessionId, cardTokenId, auth: authenticationResult, payment: null }, helpers);
                    }
                    else {
                        throw new Error('Challenge timed out');
                    }
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