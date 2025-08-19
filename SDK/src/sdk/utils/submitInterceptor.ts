import type { CheckoutComponent } from "../lib/CheckoutComponent";
import { start3DS } from '../core/start3ds';
import { performThreeDSMethod } from '../core/performThreeDSMethod';

export function interceptFormSubmit(
    form: HTMLFormElement,
    component: CheckoutComponent
) {
    let busy = false;

    const onSubmit = async (e: SubmitEvent) => {
        if (busy) { e.preventDefault(); return; }
        busy = true;
        e.preventDefault();

        const submitButtons = form.querySelectorAll<HTMLButtonElement | HTMLInputElement>('[type=submit]');
        submitButtons.forEach(b => b.disabled = true);

        try {
            const sessionId = component.getSessionId();
            if (!sessionId) throw new Error('Missing SessionID');

            // 1) tokenise (iframe → token endpoint)
            const cardTokenId = await component.requestToken();

            // 2) start 3DS
            const threeDS = await start3DS(component.getPublicKey(), cardTokenId, sessionId);

            // 3) Run 3DS Method (if provided)
            await performThreeDSMethod(
                threeDS.threeDSRequest.methodUrl,
                threeDS.threeDSRequest.methodData,
                10000
            );

            // 4) attach results & submit
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
