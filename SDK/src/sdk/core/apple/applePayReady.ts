export async function ensureApplePayReady(): Promise<boolean> {
    if ((window as any).ApplePaySession) {
        return true;
    }

    try {
        await loadApplePayScriptOnce();
        return !!(window as any).ApplePaySession;
    } catch {
        return false;
    }
}

function loadApplePayScriptOnce(): Promise<void> {
    return new Promise((resolve, reject) => {
        if (document.getElementById('apple-pay-js')) {
            return resolve();
        }

        const s = document.createElement('script');
        s.id = 'apple-pay-js';
        s.src = 'https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js';
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Failed to load Apple Pay JS'));
        document.head.appendChild(s);
    });
}

export function canMakeApplePayments(): boolean {
    const APS = (window as any).ApplePaySession;
    return !!(APS && typeof APS.canMakePayments === 'function' && APS.canMakePayments());
}