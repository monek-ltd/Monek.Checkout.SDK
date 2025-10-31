import { validateCallbacks } from "../../core/init/validateOptions";
import type { InitCallbacks } from "../../types/callbacks";
import type { AmountInput } from "../../types/transaction-details";
import type { CompletionHelpers, CompletionOptions } from "../../types/completion";

import { normaliseCountryFull } from "../utils/normaliseCountry";
import { normaliseAmount } from "../utils/normaliseCurrency";
import { Logger } from "../utils/Logger";

import { buildCompletionHelpers } from "../form/submission/buildCompletionHelpers";

import { handleValidateSession } from "./validate/handleValidateSession";
import { handlePaymentAuthorised } from "./pay/handlePaymentAuthorised";
import { invokeCompletion } from "./invokeCompletion";
import { buildApplePayPaymentRequest } from "./buildApplePayPaymentRequest";

export type ApplePayHandlerOptions = Record<string, unknown> & {
  completion?: CompletionOptions;
  form?: HTMLFormElement;
  appleMerchantLabel?: string;
  countryCode?: string | number;

  settlementType?: string;
  intent?: string;
  cardEntry?: string;
  order?: string;

  paymentReference?: string;
  validityId?: string;
  channel?: string;
  sourceIpAddress?: string;
};

const APPLE_PAY_VERSION = 14;

export async function applePayEventHandler(
  publicKey: string,
  options: ApplePayHandlerOptions,
  sessionId: string,
  logger: Logger
): Promise<void>
{
  logger.info("applePayEventHandler: start", {
    sessionId,
    hasForm: Boolean(options.form),
    label: options.appleMerchantLabel,
    countryCode: options.countryCode,
    settlementType: options.settlementType,
    intent: options.intent,
    cardEntry: options.cardEntry,
    order: options.order,
    channel: options.channel,
    paymentReference: options.paymentReference
  });

  const ApplePaySessionCtor = (window as any).ApplePaySession;
  if (!ApplePaySessionCtor)
  {
    logger.warn("ApplePaySession is not available.");
    return;
  }

  let callbacks: InitCallbacks;
  try
  {
    callbacks = getCallbacksOrThrow(options);
  }
  catch (error)
  {
    logger.error("callbacks validation failed", { message: (error as Error)?.message });
    throw error;
  }

  const amountTimer = logger.time("normalise amount/country");
  const amountInput: AmountInput = callbacks?.getAmount
    ? await callbacks.getAmount()
    : { minor: 0, currency: "826" };

  const normalisedAmount = normaliseAmount(amountInput);
  const normalisedCountry = normaliseCountryFull(options.countryCode ?? "GB");
  amountTimer.end({ amountMinor: normalisedAmount.minor, currencyAlpha3: normalisedAmount.currencyAlpha3, countryAlpha2: normalisedCountry.alpha2 });

  const applePayRequest = buildApplePayPaymentRequest({
    label: options.appleMerchantLabel ?? "Merchant",
    currencyAlpha3: normalisedAmount.currencyAlpha3,
    countryAlpha2: normalisedCountry.alpha2,
    totalMajorString: String(normalisedAmount.major),
  });
  logger.debug("built Apple Pay request", { request: applePayRequest });

  (window as any).applePaySession = new ApplePaySessionCtor(APPLE_PAY_VERSION, applePayRequest);
  const session: InstanceType<typeof ApplePaySessionCtor> = (window as any).applePaySession;
  logger.info("Apple Pay session created", { version: APPLE_PAY_VERSION });

  const hostForm = resolveHostForm(options.form, logger);
  const completionHelpers: CompletionHelpers = buildCompletionHelpers(hostForm);
  const completionOptions = options.completion;

  logger.debug("wiring session handlers");
  session.onvalidatemerchant = async (event: ApplePayJS.ApplePayValidateMerchantEvent) =>
  {
    const childLogger = logger.child("HandleValidateSession");
    childLogger.debug("onvalidatemerchant: start", { validationURL: event.validationURL });

    await handleValidateSession({
      session,
      event,
      publicKey,
      displayName: applePayRequest.total.label,
      logger: childLogger,
    });

    childLogger.debug("onvalidatemerchant: end");
  };

  session.onpaymentmethodselected = () =>
  {
    logger.debug("onpaymentmethodselected");
    session.completePaymentMethodSelection({
      newTotal: {
        label: applePayRequest.total.label,
        type: applePayRequest.total.type,
        amount: applePayRequest.total.amount,
      },
    });
  };

  session.onshippingmethodselected = () =>
  {
    logger.debug("onshippingmethodselected");
    session.completeShippingMethodSelection({
      newTotal: {
        label: applePayRequest.total.label,
        type: applePayRequest.total.type,
        amount: applePayRequest.total.amount,
      },
    });
  };

  session.onshippingcontactselected = () =>
  {
    logger.debug("onshippingcontactselected");
    session.completeShippingContactSelection({
      newTotal: {
        label: applePayRequest.total.label,
        type: applePayRequest.total.type,
        amount: applePayRequest.total.amount,
      },
    });
  };

  session.onpaymentauthorized = async (event: ApplePayJS.ApplePayPaymentAuthorizedEvent) =>
  {
    const childLogger = logger.child("HandlePaymentAuthorised");
    childLogger.debug("onpaymentauthorized: start", {
      hasToken: Boolean(event?.payment?.token),
      sessionId,
    });

    await handlePaymentAuthorised({
      session,
      event,
      publicKey,
      sessionId,
      normalisedCurrencyNumeric: normalisedAmount.currencyNumeric,
      normalisedCountryNumeric: normalisedCountry.numeric,
      options,
      callbacks,
      completionOptions,
      completionHelpers,
      logger: childLogger,
    });

    childLogger.debug("onpaymentauthorized: end");
  };

  session.oncancel = async () =>
  {
    logger.info("session cancelled by user");
    await invokeCompletion("onCancel", completionOptions, { sessionId, cardTokenId: "applepay" }, completionHelpers, logger.child("Completion"));
  };

  logger.info("session.begin");
  session.begin();
  logger.info("applePayEventHandler: ready");
}

function resolveHostForm(formFromOptions: HTMLFormElement | undefined, logger: Logger): HTMLFormElement
{
  if (formFromOptions)
  {
    logger.debug("resolveHostForm: using provided form");
    return formFromOptions;
  }

  const existingForm = document.querySelector("form");
  if (existingForm)
  {
    logger.debug("resolveHostForm: using first form in document");
    return existingForm as HTMLFormElement;
  }

  logger.warn("resolveHostForm: no form found, creating one");
  const createdForm = document.createElement("form");
  document.body.appendChild(createdForm);
  return createdForm;
}

function getCallbacksOrThrow(options: Record<string, unknown>): InitCallbacks
{
  validateCallbacks(options);
  const callbacks = options.callbacks as InitCallbacks | undefined;
  if (!callbacks)
  {
    throw new Error("Callbacks not set. Provide them during instantiation.");
  }
  return callbacks;
}
