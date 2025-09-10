import type { PaymentResponse, NormalisedPayment, CodeBucket } from '../../types/payment-payloads';

export function normalisePayment(response: PaymentResponse): NormalisedPayment {
    const bucket = response.Result as CodeBucket || null;
    const msg = response.Message ?? '';

    if (bucket === 'Success') {
        return { status: 'approved', authCode: response.AuthCode ?? null, message: msg };
    }

    // retryable vs blocked rules
    switch (bucket) {
        case 'Declined':           // 05 – generic decline > allow retry or other card
        case 'Referred':           // 02 – ask customer to contact bank / try other method
        case 'Exception':          // 30 – system hiccup > retry later
            return { status: 'retryable', reason: bucket, message: msg, code: response.ErrorCode ?? null };

        case 'InvalidCardDetails':       // 11 – fix input
            return { status: 'retryable', reason: bucket, message: msg, code: response.ErrorCode ?? null };

        case 'UnknownRetailer':   // 03 – merchant config issue
        case 'InvalidRequest':    // 12 – integration/contract error
        case 'DeclinedKeep':      // 04 – hard decline, do NOT retry same card
        default:            // unknown code > be conservative
            return { status: 'blocked', reason: bucket, message: msg, code: response.ErrorCode ?? null };
    }
}
