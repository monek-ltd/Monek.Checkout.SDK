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
export type Intent = 'Purchase' | 'AccountStatus' | 'Subscription';
export type CardEntry = 'ECommerce' | 'Manual' | 'CardOnFile';
export type Order = 'Checkout' | 'Mail' | 'Telephone' | 'Recurring' | 'Instalments';
export type SettlementType = 'Auto' | 'Manual';