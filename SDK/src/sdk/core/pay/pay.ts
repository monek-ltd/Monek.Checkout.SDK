import { API } from '../../config';
import type { PaymentResponse } from '../../types/payment-payloads';
import type { InitCallbacks } from '../../types/callbacks';


export async function pay(apiKey: string, cardTokenId: string, sessionId: string, callbacks: InitCallbacks, expiry: string): Promise<PaymentResponse> {

    const res = await fetch(`${API.base}/payment`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
        },
        body: JSON.stringify(await buildPaymentRequest(cardTokenId, sessionId, callbacks, expiry)),
    });
    if (!res.ok) {
        throw new Error(`payment failed (${res.status})`);
    }

    const j = await res.json();

    const payload: PaymentResponse = {
        Result: j.Result ?? j.result,
        ErrorCode: j.ErrorCode ?? j.errorCode,
        AuthCode: j.AuthCode ?? j.authCode,
        Message: j.Message ?? j.message,
    };
    return payload;
}

async function buildPaymentRequest(cardTokenId: string, sessionId: string, callbacks: InitCallbacks, expiry: string) {

    const amount =
        callbacks?.getAmount
            ? await callbacks.getAmount()
            : undefined;

    if (!amount) {
        throw new Error('Missing amount: pass in or provide getAmount()');
    }

    const cardholderInformation =
        callbacks?.getCardholderDetails
            ? await callbacks.getCardholderDetails()
            : undefined;

    if (!cardholderInformation) {
        throw new Error('Missing cardholder information: pass in or provide getCardholderDetails()');
    }

    const description =
        callbacks?.getDescription
            ? await callbacks.getDescription()
            : undefined;

    if (!description) {
        throw new Error('Missing description: pass in or provide getDescription()');
    }

    const expiryMonth = expiry.split('/')[0];
    const expiryYear = expiry.split('/')[1];

    return {
        sessionId,
        cardTokenId,
        deferred: false, //TODO
        paymentType: 'ECommerce', //TODO
        card: {
            cardExpiryMonth: expiryMonth,
            cardExpiryYear: expiryYear,
        },
        cardholder: {
            name: cardholderInformation.name,
            emailAddress: cardholderInformation.email,
            phoneNumber: cardholderInformation.phone,
        }
        //intent: 'purchase', //TODO
        //Order,
        //StoreCardDetails
    };
}