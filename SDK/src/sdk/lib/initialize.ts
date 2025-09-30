import { CheckoutComponent } from './CheckoutComponent';
import { ExpressComponent } from './ExpressComponent';
import { fetchAccessKeyDetails } from '../core/init/fetchAccessKey';

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
                    return new ExpressComponent(publicKey, optionsWithApplePay);
                default:
                    throw new Error(`Unsupported component type: ${type}`);
            }
        },
    };
}
