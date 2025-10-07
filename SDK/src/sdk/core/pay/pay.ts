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

    const addr = projectBillingAddress(info.billingAddress);

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
        card: {
          expiryMonth: expiryMonth,                   
          expiryYear: expiryYear,
        },
        
        cardHolder: {
          name: cardholderInformation.name,
          emailAddress: cardholderInformation.email,
          phoneNumber: cardholderInformation.phone,
          ...(addr.billingStreet1 ? { billingStreet1: addr.billingStreet1 } : {}),
          ...(addr.billingStreet2 ? { billingStreet2: addr.billingStreet2 } : {}),
          ...(addr.billingCity ? { billingCity: addr.billingCity } : {}),
          ...(addr.billingStateProv ? { billingStateProv: addr.billingStateProv } : {}),
          ...(addr.billingPostcode ? { billingPostcode: addr.billingPostcode } : {}),
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

function projectBillingAddress(addr?: {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  postcode?: string;
  country?: string;
  state?: string;
  region?: string;
}) {
  if (!addr) return {};
  const stateProv = (addr as any).state ?? (addr as any).region;
  return {
    ...(addr.addressLine1 ? { billingStreet1: addr.addressLine1 } : {}),
    ...(addr.addressLine2 ? { billingStreet2: addr.addressLine2 } : {}),
    ...(addr.city ? { billingCity: addr.city } : {}),
    ...(stateProv ? { billingStateProv: stateProv } : {}),
    ...(addr.postcode ? { billingPostcode: addr.postcode } : {}),
    countryCode: addr.country,
  };
}
