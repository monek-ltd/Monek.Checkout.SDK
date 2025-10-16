type ApplePayRequestInput = {
  label: string;
  currencyAlpha3: string;
  countryAlpha2: string;
  totalMajorString: string;
};

export function buildApplePayPaymentRequest(input: ApplePayRequestInput): ApplePayJS.ApplePayPaymentRequest
{
  return {
    merchantCapabilities: ["supports3DS", "supportsDebit", "supportsCredit"],
    supportedNetworks: ["visa", "masterCard", "amex"],
    countryCode: input.countryAlpha2,
    currencyCode: input.currencyAlpha3,
    total: {
      label: input.label,
      type: "final",
      amount: input.totalMajorString,
    },
  };
}