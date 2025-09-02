import { authorisedPayment } from "../core/authorisedPayment";
import { validateMerchantDomain } from "../core/validateMerchantDomain";

export async function applePayEventHandler() {
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
        // TODO get these from the session and form objects
        countryCode: '',
        currencyCode: '',
        total: {
            label: '',
            type: 'final',
            amount: '',
        }
    };

    // Create ApplePaySession
    const session = new ApplePaySession(14, applePayRequest);

    session.onvalidatemerchant = async (event:ApplePayJS.ApplePayValidateMerchantEvent) => {
        // Request a merchant session
        const payload = {
            validationURL: event.validationURL,
            displayName: applePayRequest.total.label,
            version: 'v2',
            parentUrl: window.parent.location.href,
            // TODO get this from session obj
            merchantRef: ''
        };

        console.log(`Payload for validating merchat URL is: ${JSON.stringify(payload)}`)

        const merchantSession = await validateMerchantDomain(payload);

        if (merchantSession?.status === '200') {

            console.log(`Merchant URL ${payload.validationURL} has been validated`);

            session.completeMerchantValidation(merchantSession.session);
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
                // TODO get this from session obj
                sessionId: ''
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