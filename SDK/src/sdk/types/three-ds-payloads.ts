export type ThreeDSMethodPayload = {
    sessionId: string;
    threeDSRequest: {
        scheme: string;
        methodUrl?: string | null;
        methodData?: string | null;
    };
};

export type ThreeDSAuthenticationPayload = {
    result: string;
    errorMessage?: string | null;
    scheme?: string | null;
    protocolVersion?: string | null;
    serverTransactionId?: string | null;
    challenge?: {
        cReq: string;
        acsUrl: string;
    } | null;
}