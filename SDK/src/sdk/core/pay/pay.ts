import { API } from '../../config';
import { CheckoutComponent } from '../../lib/CheckoutComponent';
import type { PaymentResponse } from '../../types/payment-payloads';

export async function pay(
    cardTokenId: string,
    sessionId: string,
    expiry: string,
    component: CheckoutComponent): Promise<PaymentResponse> {

    const res = await fetch(`${API.base}/payment`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': component.getPublicKey(),
        },
        body: JSON.stringify(await buildPaymentRequest(cardTokenId, sessionId, expiry, component)),
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

async function buildPaymentRequest(
    cardTokenId: string,
    sessionId: string,
    expiry: string,
    component: CheckoutComponent
    ) {

    const callbacks = component.getCallbacks();

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
        settlementType: component.getSettlementType(),
        cardEntry: component.getCardEntry(),
        intent: component.getIntent(),
        order: component.getOrder(),
        card: {
            cardExpiryMonth: expiryMonth,
            cardExpiryYear: expiryYear,
        },
        cardholder: {
            name: cardholderInformation.name,
            emailAddress: cardholderInformation.email,
            phoneNumber: cardholderInformation.phone,
        },
        storeCardDetails: component.getStoreCardDetails()
    };
}