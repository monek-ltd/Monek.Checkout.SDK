export type PaymentResponse = {
    Result: string; 
    Message: string;
    AuthCode?: string | null;
    ErrorCode?: string | null;
};

export type NormalisedPayment =
    | { status: 'approved'; authCode?: string | null; message: string }
    | { status: 'blocked'; reason: CodeBucket; message: string; code?: string | null } // do not retry
    | { status: 'retryable'; reason: CodeBucket; message: string; code?: string | null }; // user can try again

export type CodeBucket =
    | 'Success'             // 00
    | 'Referred'             // 02
    | 'UnknownRetailer'     // 03 (merchant config)
    | 'DeclinedKeep'        // 04 (hard decline, do not retry)
    | 'Declined'             // 05
    | 'InvalidCardDetails'         // 11
    | 'InvalidRequest'      // 12 (client/server contract issue)
    | 'Exception'