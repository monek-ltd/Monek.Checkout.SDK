export const RUNTIME_ENV = 'prod';
export const API = {
    base: import.meta.env.VITE__MONEK_API || 'https://api.monek.com/embedded-checkout',
    appleSession: import.meta.env.VITE__MONEK_APPLE_SESSION || 'https://api.monek.com/apple-pay/session',
};
export const WS = {
    base: import.meta.env.VITE__MONEK_WS || 'wss://wqen1zbhll.execute-api.eu-west-2.amazonaws.com/v1/',
};
export const FRAMES = {
    base: import.meta.env.VITE__MONEK_FRAMES || 'https://checkout-js.monek.com',
};
