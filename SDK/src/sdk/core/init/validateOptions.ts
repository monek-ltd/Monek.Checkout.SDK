export function validateCallbacks(options: Record<string, any>) {
    if (!options.callbacks) {
        throw new Error('[Monek] Missing callbacks object in options');
    }
    validateOptions(options.callbacks, ['getAmount', 'getCardholderDetails', 'getDescription']);
}

function validateOptions(options: Record<string, any>, requiredFields: string[]) {
    const missingFields = requiredFields.filter(field => !(field in options));
    if (missingFields.length > 0) {
        throw new Error(`[Monek] Missing required options: ${missingFields.join(', ')}`);
    }
}