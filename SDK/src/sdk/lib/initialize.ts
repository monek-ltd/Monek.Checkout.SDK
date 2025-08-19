import { CheckoutComponent } from './CheckoutComponent';
import { ExpressComponent } from './ExpressComponent';
import { API } from '../config';

export async function init(publicKey: string, options: Record<string, any> = {}) {
    if (!publicKey) throw new Error('Missing public key');

    const defaultOptions = {
        ...options,
    };

    const accessKeyDetails = await fetchAccessKeyDetails(publicKey);

    return {
        createComponent(
            type: 'checkout' | 'express',
            componentOptions = defaultOptions
        ) {
            const optionsWithApplePay = {
                ...componentOptions,
                applePayEnabled: accessKeyDetails.applePayEnabled, //TODO: Block button if Apple Pay is not enabled
            };

            switch (type) {
                case 'checkout':
                    return new CheckoutComponent(publicKey, optionsWithApplePay);
                case 'express':
                    return new ExpressComponent(optionsWithApplePay);
                default:
                    throw new Error(`Unsupported component type: ${type}`);
            }
        },
    };
}

export async function fetchAccessKeyDetails(publicKey: string) {
    const response = await fetch(`${API.base}/embedded-checkout/key/${publicKey}`);
    if (!response.ok) {
        throw new Error(`Unable to retrieve access key: ${response.status}`);
    }

    return await response.json();
}

