import type { Amount, CardholderDetails} from './transaction-details';

export type InitCallbacks = {
    getAmount?: () => Promise<Amount> | Amount;
    getCardholderDetails?: () => Promise<CardholderDetails> | CardholderDetails;
    getDescription?: () => Promise<string> | string;
}