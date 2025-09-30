import { authorisedPayment } from "./authorisedPayment";
import { validateMerchantDomain } from "./validateMerchantDomain";
import { validateCallbacks } from '../../core/init/validate';
import type { InitCallbacks } from '../../types/callbacks';
import type { AmountInput } from '../../types/transaction-details'
import { normalizeAmount, normalizeCountry } from '../utils/currencyHelper';

export async function applePayEventHandler(publicKey: string, options: Record<string, any>, sessionId: string) {

    const APSession = (window as any).ApplePaySession;
    if (!APSession) {
        console.warn('[ApplePay] ApplePaySession is not available.');
        return;
    }

    const callbacks = getCallbacks(options);

    const amount =
        callbacks?.getAmount
            ? await callbacks.getAmount()
            : { minor: 0, currency: '826' } as AmountInput;

    const normalizedAmount = normalizeAmount(amount);
    const normalizedCountry = normalizeCountry(options.countryCode ?? 'GB');

    const applePayRequest: ApplePayJS.ApplePayPaymentRequest = {
        merchantCapabilities: [
            'supports3DS',
            'supportsDebit',
            'supportsCredit'
        ],
        supportedNetworks: [
            'visa',
            'masterCard',
            'amex'
        ],
        countryCode: normalizedCountry.alpha2,
        currencyCode: normalizedAmount.currencyAlpha3,
        total: {
            label: options.label || 'Pay Now',
            type: 'final',
            amount: normalizedAmount.major
        }
    };

    // Create ApplePaySession
    const session = new APSession(14, applePayRequest);

    session.onvalidatemerchant = async (event:ApplePayJS.ApplePayValidateMerchantEvent) => {
        // Request a merchant session
        const payload = {
            validationURL: event.validationURL,
            displayName: applePayRequest.total.label,
            parentUrl: document.location.hostname,
        };

        console.log(`Payload for validating merchat URL is: ${JSON.stringify(payload)}`)

        const merchantSession = await validateMerchantDomain(publicKey, payload);

        if (merchantSession?.status === '200') {

            console.log(`Merchant URL ${payload.validationURL} has been validated`);

            session.completeMerchantValidation(merchantSession);
        } else {
            console.error("Merchant could not be validated");
        }
    };
    
    session.onpaymentmethodselected = () => {
        const update: ApplePayJS.ApplePayPaymentMethodUpdate = {
            newTotal: {
                label: applePayRequest.total.label,
                type: applePayRequest.total.type, // Use the original type or map event.type if needed
                amount: applePayRequest.total.amount,
            }
        };

        session.completePaymentMethodSelection(update);
    };

    session.onshippingmethodselected = () => {
        const update: ApplePayJS.ApplePayShippingMethodUpdate = {
            newTotal: {
                label: applePayRequest.total.label,
                type: applePayRequest.total.type,
                amount: applePayRequest.total.amount,
            }
        }
        session.completeShippingMethodSelection(update);
    };

    session.onshippingcontactselected = () => {
        const update: ApplePayJS.ApplePayShippingMethodUpdate = {
            newTotal: {
                label: applePayRequest.total.label,
                type: applePayRequest.total.type,
                amount: applePayRequest.total.amount,
            }
        }
        session.completeShippingContactSelection(update);
    };

    session.onpaymentauthorized = async (event: ApplePayJS.ApplePayPaymentAuthorizedEvent) => {
        const paymentData = event.payment;

        if (paymentData.token) {
            const payload = {
                token: paymentData.token,
                sessionId: sessionId,
            }

            // Forward token to Monek gateway for processing payment and return result to apple pay
            try {
                const paymentResponse = await authorisedPayment(payload);

                if (paymentResponse.message.toUpperCase() === "SUCCESS") {
                    session.completePayment({
                        "status": ApplePaySession.STATUS_SUCCESS
                    });
                } else {
                    session.completePayment({
                        "status": ApplePaySession.STATUS_FAILURE
                    });
                }
            } 
            catch (error) {
                console.error("Error during authorising payment: ", error);

                session.completePayment({
                    "status": ApplePaySession.STATUS_FAILURE
                });
            }
        }
    };

    session.oncancel = () => {
        console.log("Session Cancelled.");
    };

    session.begin();
    
}

function getCallbacks(options: Record<string, any>): InitCallbacks | undefined {
    validateCallbacks(options);
    let callbacks = options.callbacks as InitCallbacks | undefined;

    if (!callbacks) {
        throw new Error('Callbacks not set. Provide them during instantiation.');
    }
    return callbacks;
}