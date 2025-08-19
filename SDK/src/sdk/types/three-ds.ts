export type ThreeDSMethodPayload = {
    sessionId: string;
    threeDSRequest: {
        scheme: string;
        methodUrl?: string | null;
        methodData?: string | null;
    };
};
