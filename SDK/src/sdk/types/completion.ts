export type Redirect = {
    url: string;
    parameters: { [key: string]: string };
    method: 'GET' | 'POST';
}

export type CompletionMode = 'client' | 'form';

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

export type CompletionContext = {
    cardTokenId: string;
    sessionId: string;
    auth?: any;
    payment?: any;
    error?: Error | unknown;
}