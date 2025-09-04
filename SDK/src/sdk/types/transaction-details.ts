export type Amount = { value: number; currencyCode: string };
export type Address = {
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    postcode?: string;
    country?: string;
};
export type CardholderDetails = {
    name?: string;
    email?: string;
    phone?: string;
    billingAddress?: Address;
};
export type Intent = 'purchase' | 'account-status' | 'reservation' | 'refund';
export type CardEntry = 'e-commerce' | 'manual' | 'card-on-file';
export type Order = 'checkout' | 'unspecified' | 'mail' | 'telephone' | 'recurring' | 'installment' | 'one-click' | 'standing-order';