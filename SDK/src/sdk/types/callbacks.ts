import type { AmountInput, CardholderDetails } from './transaction-details';

export type InitCallbacks = {
    getAmount?: () => Promise<AmountInput> | AmountInput;
    getCardholderDetails?: () => Promise<CardholderDetails> | CardholderDetails;
    getDescription?: () => Promise<string> | string;
}
