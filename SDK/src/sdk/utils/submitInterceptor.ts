import type { CheckoutComponent } from "../lib/CheckoutComponent";
import { getThreeDSMethodData } from '../core/3ds/panInformation';
import { performThreeDSMethodInvocation } from '../core/3ds/methodInvocation';
import { authenticate } from '../core/3ds/authenticate';
import { challenge } from "../core/3ds/challenge";

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

        try {
            const sessionId = component.getSessionId();
            if (!sessionId) throw new Error('Missing SessionID');

            // 1) tokenise (iframe → token endpoint)
            const cardTokenId = await component.requestToken();

            // 2) start 3DS
            const threeDS = await getThreeDSMethodData(component.getPublicKey(), cardTokenId, sessionId);

            // 3) Run 3DS Method (if provided)
            await performThreeDSMethodInvocation(
                threeDS.threeDSRequest.methodUrl,
                threeDS.threeDSRequest.methodData,
                10000
            );

            // 4) Call 3DS Authentication
            const authenticationResult = await authenticate(component.getPublicKey(), cardTokenId, sessionId, component.getCallbacks(), await component.requestExpiry())
            if (authenticationResult.errorMessage) {
                throw new Error(`3DS authentication error: ${authenticationResult.errorMessage}`);
            }
            console.log('3DS authentication result:', authenticationResult);

            // 4a) If challenge required, run challenge flow
            if(authenticationResult.result === 'challenge') {
                const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
                const display = component['options']?.challenge?.display ?? 'popup';
                const size = component['options']?.challenge?.size ?? 'medium';

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
                    throw new Error('Challenge cancelled by user');
                }
                if (result.kind === 'timeout') {
                    throw new Error('Challenge timed out');
                }
            }
            // 4b) If not authenticated, do something
            else if(authenticationResult === 'not-authenticated') {
                //TODO
            }

            // 5) attach results & submit
            attachHidden(form, 'CardTokenID', cardTokenId);
            attachHidden(form, 'SessionID', sessionId);

            // native submit
            form.submit();
        } catch (err) {
            console.error('[Checkout] submit flow error:', err);
            submitButtons.forEach(b => b.disabled = false);
            busy = false;
        }
    };

    form.addEventListener('submit', onSubmit, { capture: true });
    return () => form.removeEventListener('submit', onSubmit, { capture: true } as any);
}

function attachHidden(form: HTMLFormElement, name: string, value: string) {
    let input = form.querySelector<HTMLInputElement>(`input[name="${name.replace(/"/g, '\\"')}"]`);
    if (!input) {
        input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        form.appendChild(input);
    }
    input.value = String(value);
}
