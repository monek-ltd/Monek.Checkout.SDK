import { authorisedPayment } from "./authorisedPayment";
import { validateMerchantDomain } from "./validateMerchantDomain";
import { validateCallbacks } from '../../core/init/validate';
import type { InitCallbacks } from '../../types/callbacks';
import type { AmountInput } from '../../types/transaction-details'
import { normaliseCountryFull } from '../utils/countryHelper';
import { normaliseAmount } from '../utils/currencyHelper';

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

    const normalisedAmount = normaliseAmount(amount);
    const normalisedCountry = normaliseCountryFull(options.countryCode ?? 'GB');

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
        countryCode: normalisedCountry.alpha2,
        currencyCode: normalisedAmount.currencyAlpha3,
        total: {
            label: options.label || 'Pay Now',
            type: 'final',
            amount: String(normalisedAmount.major)
        }
    };

    // Create ApplePaySession
    (window as any).applePaySession = new APSession(14, applePayRequest);
    const session: InstanceType<typeof APSession> = (window as any).applePaySession;


    session.onvalidatemerchant = async (event:ApplePayJS.ApplePayValidateMerchantEvent) => {
        // Request a merchant session
        const payload = {
            validationURL: event.validationURL,
            displayName: applePayRequest.total.label,
            parentUrl: document.location.hostname,
            merchantRef: publicKey,
            version: "V2"
        };

        console.log(`Payload for validating merchat URL is: ${JSON.stringify(payload)}`)

        const merchantSession = await validateMerchantDomain(payload);

        if (merchantSession?.status === '200') {

            console.log(`Merchant URL ${payload.validationURL} has been validated`);
            
            const appleSession = (merchantSession as any).session ?? merchantSession;

            session.completeMerchantValidation(appleSession);

            console.log("Validation Complete");
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

            try {
                  const description = callbacks?.getDescription ? await callbacks.getDescription() : undefined;
                  const url = typeof window !== 'undefined' && window?.location?.href ? window.location.href : undefined;
                  const source = typeof navigator !== 'undefined' && navigator?.userAgent ? `web:${navigator.userAgent}` : 'EmbeddedCheckout';

                  const body = {
                    SessionId: sessionId,
                    SettlementType: options.settlementType ?? 'Auto', 
                    Intent: options.intent ?? 'Purchase',     
                    CardEntry: options.cardEntry ?? 'ECommerce', 
                    Order: options.order ?? 'Checkout',  
                    currencyCode: normalisedAmount.currencyNumeric,

                    PaymentReference: options.paymentReference ?? undefined,
                    IdempotencyToken: crypto.randomUUID(),
                    ValidityId: options.validityId ?? undefined,
                    Channel: options.channel ?? 'Web',
                    Source: source,
                    SourceIpAddress: options.sourceIpAddress ?? undefined, 
                    Url: url,
                    BasketDescription: description,

                    Token: paymentData.token
                    };

                const paymentResponse = await authorisedPayment(publicKey, body);

                if (paymentResponse.message.toUpperCase() === "SUCCESS") {
                    session.completePayment({
                        "status": APSession.STATUS_SUCCESS
                    });
                } else {
                    session.completePayment({
                        "status": APSession.STATUS_FAILURE
                    });
                }
            } 
            catch (error) {
                console.error("Error during authorising payment: ", error);

                session.completePayment({
                    "status": APSession.STATUS_FAILURE
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