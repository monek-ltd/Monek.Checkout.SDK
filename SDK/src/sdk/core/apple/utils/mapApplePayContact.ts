import type { ExpressContactDetails, ExpressPaymentDetails } from '../../../types/express';
import type { Address } from '../../../types/transaction-details';

export function mapApplePayPayment(
    payment: ApplePayJS.ApplePayPayment | undefined,
    sessionId: string
): ExpressPaymentDetails | undefined {
    if (!payment) {
        return undefined;
    }

    const billingContact = mapContact(payment.billingContact);
    const shippingContact = mapContact(payment.shippingContact);

    if (!billingContact && !shippingContact) {
        return undefined;
    }

    return {
        sessionId,
        ...(billingContact ? { billingContact } : {}),
        ...(shippingContact ? { shippingContact } : {}),
    };
}

function mapContact(contact?: ApplePayJS.ApplePayPaymentContact): ExpressContactDetails | undefined {
    if (!contact) {
        return undefined;
    }

    const address = buildAddress(contact);
    const nameParts = [contact.givenName, contact.familyName]
        .map((value) => value?.trim())
        .filter(Boolean);

    const details: ExpressContactDetails = {
        ...(nameParts.length ? { name: nameParts.join(' ') } : {}),
        ...(contact.emailAddress ? { email: contact.emailAddress } : {}),
        ...(contact.phoneNumber ? { phone: contact.phoneNumber } : {}),
        ...(address ? { address } : {}),
    };

    if (!details.name && !details.email && !details.phone && !details.address) {
        return undefined;
    }

    return details;
}

export type ApplePayCardHolder = {
    name?: string;
    emailAddress?: string;
    phoneNumber?: string;
    billingStreet1?: string;
    billingStreet2?: string;
    billingCity?: string;
    billingPostcode?: string;
    billingCountry?: string;
    shippingStreet1?: string;
    shippingStreet2?: string;
    shippingCity?: string;
    shippingPostcode?: string;
    shippingCountry?: string;
};

// Builds the CardHolder payload sent to the backend
export function mapApplePayCardHolder(
    payment: ApplePayJS.ApplePayPayment | undefined
): ApplePayCardHolder | undefined {
    if (!payment) {
        return undefined;
    }

    const billingContact = payment.billingContact;
    const shippingContact = payment.shippingContact;

    const billingAddress = billingContact ? buildAddress(billingContact) : undefined;
    const shippingAddress = shippingContact ? buildAddress(shippingContact) : undefined;

    const nameParts = [billingContact?.givenName, billingContact?.familyName]
        .map((value) => value?.trim())
        .filter(Boolean);

    const cardHolder: ApplePayCardHolder = {
        ...(nameParts.length ? { name: nameParts.join(' ') } : {}),
        ...(billingContact?.emailAddress ? { emailAddress: billingContact.emailAddress } : {}),
        ...(billingContact?.phoneNumber ? { phoneNumber: billingContact.phoneNumber } : {}),
        ...(billingAddress?.addressLine1 ? { billingStreet1: billingAddress.addressLine1 } : {}),
        ...(billingAddress?.addressLine2 ? { billingStreet2: billingAddress.addressLine2 } : {}),
        ...(billingAddress?.city ? { billingCity: billingAddress.city } : {}),
        ...(billingAddress?.postcode ? { billingPostcode: billingAddress.postcode } : {}),
        ...(billingAddress?.country ? { billingCountry: billingAddress.country } : {}),
        ...(shippingAddress?.addressLine1 ? { shippingStreet1: shippingAddress.addressLine1 } : {}),
        ...(shippingAddress?.addressLine2 ? { shippingStreet2: shippingAddress.addressLine2 } : {}),
        ...(shippingAddress?.city ? { shippingCity: shippingAddress.city } : {}),
        ...(shippingAddress?.postcode ? { shippingPostcode: shippingAddress.postcode } : {}),
        ...(shippingAddress?.country ? { shippingCountry: shippingAddress.country } : {}),
    };

    return Object.keys(cardHolder).length ? cardHolder : undefined;
}

function buildAddress(contact: ApplePayJS.ApplePayPaymentContact): Address | undefined {
    const [line1, line2, ...restLines] = contact.addressLines ?? [];
    const additionalLine = restLines.filter(Boolean).join(' ').trim();
    const cleanLine2 = [line2, additionalLine].filter(Boolean).join(' ').trim();

    const address: Address = {
        ...(line1 ? { addressLine1: line1 } : {}),
        ...(cleanLine2 ? { addressLine2: cleanLine2 } : {}),
        ...(contact.locality ? { city: contact.locality } : {}),
        ...(contact.postalCode ? { postcode: contact.postalCode } : {}),
        ...(contact.countryCode ? { country: contact.countryCode } : {}),
    };

    return Object.keys(address).length ? address : undefined;
}
