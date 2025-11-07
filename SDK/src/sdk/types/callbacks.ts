import type { AmountInput, CardholderDetails } from './transaction-details';
import type { ExpressPaymentDetails } from './express';

export type InitCallbacks = {
    getAmount?: () => Promise<AmountInput> | AmountInput;
    getCardholderDetails?: () => Promise<CardholderDetails> | CardholderDetails;
    getDescription?: () => Promise<string> | string;
    onExpressPaymentDetails?: (details: ExpressPaymentDetails) => Promise<void> | void;
}
