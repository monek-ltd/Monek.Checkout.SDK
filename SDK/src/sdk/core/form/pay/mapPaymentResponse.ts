import type { PaymentResponse } from './payment-payloads';

export function mapPaymentResponse(raw: any): PaymentResponse
{
  return {
    Result: raw?.Result ?? raw?.result,
    ErrorCode: raw?.ErrorCode ?? raw?.errorCode,
    AuthCode: raw?.AuthCode ?? raw?.authCode,
    Message: raw?.Message ?? raw?.message,
  };
}
