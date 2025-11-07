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
