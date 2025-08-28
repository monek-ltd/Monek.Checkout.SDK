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