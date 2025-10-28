import type { CheckoutPort } from '../../../types/checkout-port';
import type { CompletionOptions } from "../../../types/completion";
import { normalisePayment } from '../pay/normalisePayment';
import { pay } from '../pay/makePayment';
import { runCompletionHook } from '../helpers/runCompletionHook';
import { attachHidden } from '../helpers/performRedirect';

type CompletionContext = {
  sessionId: string;
  cardTokenId: string;
  expiry: string;
  auth: any;
};

export async function completeSubmission(
  form: HTMLFormElement,
  component: CheckoutPort,
  completionOptions: CompletionOptions | undefined,
  context: CompletionContext,
  helpers: Parameters<typeof runCompletionHook>[2]
): Promise<void>
{
    if (completionOptions?.mode === 'client') {
        const paymentResult = await pay(context.cardTokenId, context.sessionId, context.expiry, component);
        const normalisedPaymentResponse = normalisePayment(paymentResult);

        const hookContext = { sessionId: context.sessionId, cardTokenId: context.cardTokenId, auth: context.auth, payment: paymentResult };

        if (normalisedPaymentResponse.status === 'approved') {
            if (completionOptions.onSuccess) {
                await runCompletionHook(completionOptions.onSuccess, hookContext, helpers);
            }
            else {
                throw new Error('Payment approved but no onSuccess handler');
            }
        }
        else {
            if (completionOptions.onError) {
                await runCompletionHook(completionOptions.onError, hookContext, helpers);
            }
            else {
                throw new Error(`Payment error: ${normalisedPaymentResponse.reason}`);
            }
        }
        return;
    }
    else if (completionOptions?.mode === 'form') {

        // Server mode: attach fields and submit original form
        attachHidden(form, 'CardTokenID', context.cardTokenId);
        attachHidden(form, 'SessionID', context.sessionId);
        form.submit();
    }
}
