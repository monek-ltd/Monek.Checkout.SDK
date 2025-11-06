export type Redirect = {
    url: string;
    parameters: { [key: string]: string };
    method: 'GET' | 'POST';
}

export type CompletionMode = 'client' | 'form' | 'none';

export type CompletionOptions = {
    mode?: CompletionMode; 
    onSuccess?: CompletionHook;
    onError?: CompletionHook;
    onCancel?: CompletionHook;
    onClosed?: CompletionHook;
}

export type CompletionHelpers = {
    redirect: (to: Redirect | string) => void;
    submitForm: (fields?: Record<string, string>) => void;
    reenable: () => void;
    disable: () => void;
};

export type CompletionHook =
    | Redirect
    | ((ctx: CompletionContext, helpers: CompletionHelpers) => unknown);

export type ApplePayContactDetails = {
    emailAddress?: string;
    phoneNumber?: string;
    givenName?: string;
    familyName?: string;
    middleName?: string;
    phoneticGivenName?: string;
    phoneticFamilyName?: string;
    phoneticMiddleName?: string;
    organisationName?: string;
    addressLines?: string[];
    locality?: string;
    subLocality?: string;
    supplementarySubLocality?: string;
    postalCode?: string;
    administrativeArea?: string;
    subAdministrativeArea?: string;
    country?: string;
    countryCode?: string;
};

export type ApplePayShippingMethodDetails = {
    amount?: string;
    label?: string;
    detail?: string;
    identifier?: string;
    type?: string;
};

export type ApplePayCompletionDetails = {
    payerEmail?: string;
    payerPhone?: string;
    payerName?: string;
    billingContact?: ApplePayContactDetails;
    shippingContact?: ApplePayContactDetails;
    shippingMethod?: ApplePayShippingMethodDetails;
};

export type CompletionContext = {
    cardTokenId: string;
    sessionId: string;
    auth?: any;
    payment?: any;
    error?: Error | unknown;
    applePay?: ApplePayCompletionDetails;
}