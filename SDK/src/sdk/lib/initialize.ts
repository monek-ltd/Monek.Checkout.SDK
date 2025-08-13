import { CheckoutComponent } from './CheckoutComponent';
import { ExpressComponent } from './ExpressComponent';

export async function init(publicKey: string, options: Record<string, any> = {}) {
    if (!publicKey) throw new Error('Missing public key');

    const defaultOptions = {
        environment: 'dev',
        ...options,
    };

    const accessKeyDetails = await fetchAccessKeyDetails(publicKey, defaultOptions.environment);

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
                    return new CheckoutComponent(optionsWithApplePay);
                case 'express':
                    return new ExpressComponent(optionsWithApplePay);
                default:
                    throw new Error(`Unsupported component type: ${type}`);
            }
        },
    };
}

export async function fetchAccessKeyDetails(publicKey: string, environment : string) {
    const baseUrl = environment === 'prod' //TODO: Add staging environment check
        ? 'https://api.monek.com'
        : 'https://api-dev.monek.com';

    const response = await fetch(`${baseUrl}/embedded-checkout/key/${publicKey}`);
    if (!response.ok) {
        throw new Error(`Unable to retrieve access key: ${response.status}`);
    }

    return await response.json();
}

