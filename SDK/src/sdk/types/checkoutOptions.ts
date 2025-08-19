export type CheckoutOptions = {
    sessionId: string;
    frameUrl: string;
    perform3DSEndpoint: string;
    targetOrigin?: string;
};