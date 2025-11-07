import type { Address } from './transaction-details';

export type ExpressContactDetails = {
    name?: string;
    email?: string;
    phone?: string;
    address?: Address;
};

export type ExpressPaymentDetails = {
    sessionId: string;
    billingContact?: ExpressContactDetails;
    shippingContact?: ExpressContactDetails;
};
