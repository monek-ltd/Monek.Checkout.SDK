type RequireExactlyOne<T, K extends keyof T = keyof T> =
    { [P in K]: Required<Pick<T, P>> & Partial<Record<Exclude<K, P>, never>> }[K] & Omit<T, K>;

// Accept either ISO-4217 alpha-3 ("GBP") or numeric ("826") — string or number.
export type CurrencyCode = string | number;

// Accept either ISO-3166-1 alpha-2 ("GB") or numeric ("826") — string or number.
export type CountryCode = string | number;

export type AmountInput =
    RequireExactlyOne<{ minor: number; major: string | number }, 'minor' | 'major'> & {
        currency: CurrencyCode;
    };

export type AmountNormalized = {
    minor: number;
    major: string;
    currencyAlpha3: string;
    currencyNumeric: string;
};

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