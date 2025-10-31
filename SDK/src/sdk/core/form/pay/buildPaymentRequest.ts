import type { CheckoutPort } from '../../../types/checkout-port';
import { normaliseAmount } from '../../utils/normaliseCurrency';

export async function buildPaymentRequest(
  cardTokenId: string,
  sessionId: string,
  expiry: string,
  component: CheckoutPort
)
{
    const callbacks = component.getCallbacks();

    const amount = callbacks?.getAmount
        ? await callbacks.getAmount()
        : undefined;

    if (!amount)
    {
        throw new Error('Missing amount: pass in or provide getAmount()');
    }

    const normalisedAmount = normaliseAmount(amount);

    const cardholderInformation = callbacks?.getCardholderDetails
        ? await callbacks.getCardholderDetails()
        : undefined;

    if (!cardholderInformation)
    {
        throw new Error('Missing cardholder information: pass in or provide getCardholderDetails()');
    }

    const description = callbacks?.getDescription
        ? await callbacks.getDescription()
        : undefined;

    if (!description)
    {
        throw new Error('Missing description: pass in or provide getDescription()');
    }
  
    const expiryMonth = expiry.split('/')[0];
    const expiryYear = expiry.split('/')[1];

    const billing = cardholderInformation.billingAddress;
    const sourceIpAddress = await component.getSourceIp();

    const currentUrl =
    typeof window !== 'undefined' && window?.location?.href
        ? window.location.href
        : undefined;

    const userAgent =
    typeof navigator !== 'undefined' && navigator?.userAgent
        ? `web:${navigator.userAgent}`
        : 'EmbeddedCheckout';

    return {
        sessionId,
        tokenId: cardTokenId,

        settlementType: component.getSettlementType(),
        cardEntry: component.getCardEntry(),
        intent: component.getIntent(),
        order: component.getOrder(),

        currencyCode: normalisedAmount.currencyNumeric,
        minorAmount: normalisedAmount.minor,

        countryCode: component.getCountryCode().numeric,

        card: {
            expiryMonth,
            expiryYear,
        },

        cardHolder: {
            name: cardholderInformation.name,
            emailAddress: cardholderInformation.email,
            phoneNumber: cardholderInformation.phone,
            ...(billing?.addressLine1 ? { billingStreet1: billing.addressLine1 } : {}),
            ...(billing?.addressLine2 ? { billingStreet2: billing.addressLine2 } : {}),
            ...(billing?.city ? { billingCity: billing.city } : {}),
            ...(billing?.postcode ? { billingPostcode: billing.postcode } : {}),
        },

        storeCardDetails: component.getStoreCardDetails(),

        idempotencyToken: safeUuid(),

        source: userAgent,
        ...(sourceIpAddress ? { sourceIpAddress } : {}),
        ...(currentUrl ? { url: currentUrl } : {}),

        basketDescription: description,

        validityId: component.getValidityId(),
        channel: component.getChannel(),

        paymentReference: component.getPaymentReference(),
    };
}

function safeUuid(): string
{
    try
    {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        {
            return crypto.randomUUID();
        }
    }
    catch {}

    return `sdk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
