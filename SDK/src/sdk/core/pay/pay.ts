import { API } from '../../config';
import { CheckoutComponent } from '../../lib/CheckoutComponent';
import { normalizeAmount } from '../utils/currencyHelper';
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
    
    const amount = 
        callbacks?.getAmount 
            ? await callbacks.getAmount() 
            : undefined;

    if (!amount) { 
        throw new Error('Missing amount: pass in or provide getAmount()');
    }

    const normalizedAmount = normalizeAmount(amount);

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

    const addr = cardholderInformation.billingAddress;

    const ip = await component.getSourceIp();
    const url = (typeof window !== 'undefined' && window?.location?.href) ? window.location.href : undefined;
    const source = (typeof navigator !== 'undefined' && navigator?.userAgent)
    ? `web:${navigator.userAgent}`
    : 'EmbeddedCheckout';

    return {
        sessionId,
        tokenId: cardTokenId,                            
        settlementType: component.getSettlementType(),
        cardEntry: component.getCardEntry(),
        intent: component.getIntent(),
        order: component.getOrder(),
        currencyCode: normalizedAmount.currencyNumeric,
        card: {
          expiryMonth: expiryMonth,                   
          expiryYear: expiryYear,
        },
        
        cardHolder: {
          name: cardholderInformation.name,
          emailAddress: cardholderInformation.email,
          phoneNumber: cardholderInformation.phone,
          ...(addr?.addressLine1 ? { billingStreet1: addr.addressLine1 } : {}),
          ...(addr?.addressLine2 ? { billingStreet2: addr.addressLine2 } : {}),
          ...(addr?.city ? { billingCity: addr.city } : {}),
          ...(addr?.postcode ? { billingPostcode: addr.postcode } : {}),
        },
        storeCardDetails: component.getStoreCardDetails(),
        idempotencyToken: crypto.randomUUID(),
        source,
        ...(ip ? { sourceIpAddress: ip } : {}),
        ...(url ? { url } : {}),
        basketDescription: description,
        validityId: component.getValidityId?.() ?? undefined,
        channel: component.getChannel?.() ?? 'Web',
      };
}
