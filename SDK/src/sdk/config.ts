type Env = 'dev' | 'prod';

function detectEnv(): Env {
    try {
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            const queryValue = (params.get('monek-sdk-env') || '').toLowerCase();
            if (queryValue === 'dev' || queryValue === 'prod') return queryValue;
        }
    } catch { }

    let host = '';
    if (typeof window !== 'undefined') {
        host = window.location.hostname.toLowerCase();
    } else if (typeof global !== 'undefined' && (global as any).location?.hostname) {
        host = (global as any).location.hostname.toLowerCase();
    }

    if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host.startsWith('dev-') ||
        host === 'dev-checkout-js.monek.com'
    ) {
        return 'dev';
    }

    return 'prod';
}

const ENV: Env = detectEnv();

const CONFIG_BY_ENV = {
    dev: {
        API: {
            base: 'https://api-dev.monek.com/embedded-checkout', 
            appleSession: 'https://api-dev.monek.com/apple-pay/session',
        },
        WS: {
            base: 'wss://dev-ws.monek.com/v1/',                
        },
        frames: {
            base: 'https://dev-checkout-js.monek.com',
        },
    },
    prod: {
        API: {
            base: 'https://api.monek.com/embedded-checkout',
            appleSession: 'https://api.monek.com/apple-pay/session',
        },
        WS: {
            base: 'wss://wqen1zbhll.execute-api.eu-west-2.amazonaws.com/v1/',
        },
        frames: {
                base: 'https://checkout-js.monek.com',
            },
        },
} as const;

export const RUNTIME_ENV = ENV;
export const API = CONFIG_BY_ENV[ENV].API;
export const WS = CONFIG_BY_ENV[ENV].WS;
export const FRAMES = CONFIG_BY_ENV[ENV].frames;