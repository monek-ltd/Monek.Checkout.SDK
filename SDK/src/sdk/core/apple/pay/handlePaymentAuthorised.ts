import type { CompletionOptions, CompletionHelpers, CompletionContext } from "../../../types/completion";
import type { InitCallbacks } from "../../../types/callbacks";
import type { ApplePayHandlerOptions } from "../applePayEventHandler";

import { Logger } from "../../utils/Logger";
import { authorisedPayment } from "./authorisedPayment";
import { invokeCompletion } from "../invokeCompletion";

type HandlePaymentAuthorisedParams = {
  session: any;
  event: ApplePayJS.ApplePayPaymentAuthorizedEvent;
  publicKey: string;
  sessionId: string;
  normalisedCurrencyNumeric: string;
  normalisedCountryNumeric: string;
  options: ApplePayHandlerOptions;
  callbacks: InitCallbacks;
  completionOptions?: CompletionOptions;
  completionHelpers: CompletionHelpers;
  logger: Logger;
};

export async function handlePaymentAuthorised(params: HandlePaymentAuthorisedParams): Promise<void>
{
  const {
    session,
    event,
    publicKey,
    sessionId,
    normalisedCurrencyNumeric,
    normalisedCountryNumeric,
    options,
    callbacks,
    completionOptions,
    completionHelpers,
    logger 
  } = params;

  const paymentData = event.payment;

  if (!paymentData?.token)
  {
    session.completePayment({ status: (window as any).ApplePaySession.STATUS_FAILURE });
    await invokeCompletion(
      "onError",
      completionOptions,
      { sessionId, cardTokenId: "applepay", payment: { code: "NO_TOKEN" } },
      completionHelpers,
      logger
    );
    return;
  }

  try
  {
    const description = callbacks?.getDescription ? await callbacks.getDescription() : undefined;

    const currentUrl =
      typeof window !== "undefined" && window?.location?.href
        ? window.location.href
        : undefined;

    const source =
      typeof navigator !== "undefined" && navigator?.userAgent
        ? `web:${navigator.userAgent}`
        : "EmbeddedCheckout";

    const authoriseBody = {
      sessionId,
      settlementType: options.settlementType ?? "Auto",
      intent: options.intent ?? "Purchase",
      cardEntry: options.cardEntry ?? "ECommerce",
      order: options.order ?? "Checkout",

      currencyCode: normalisedCurrencyNumeric,
      countryCode: normalisedCountryNumeric,

      paymentReference: (options as any).paymentReference ?? undefined,
      idempotencyToken: safeUuid(),
      validityId: (options as any).validityId ?? undefined,
      channel: (options as any).channel ?? "Web",
      source,
      sourceIpAddress: (options as any).sourceIpAddress ?? undefined,
      url: currentUrl,
      basketDescription: description,

      token: paymentData.token,
    };

    const paymentResponse = await authorisedPayment(publicKey, authoriseBody);
    const approved = String(paymentResponse?.result ?? "").toUpperCase() === "SUCCESS";

    session.completePayment({
      status: approved ? (window as any).ApplePaySession.STATUS_SUCCESS : (window as any).ApplePaySession.STATUS_FAILURE,
    });

    const completionContext: CompletionContext = {
      sessionId,
      cardTokenId: paymentData?.token?.transactionIdentifier ?? "applepay",
      auth: { applePay: event.payment?.token },
      payment: paymentResponse,
    };

    if (approved)
    {
      await invokeCompletion("onSuccess", completionOptions, completionContext, completionHelpers, logger);
    }
    else
    {
      await invokeCompletion("onError", completionOptions, completionContext, completionHelpers, logger);
    }
  }
  catch (error)
  {
    logger.error("Error during authorising payment: ", error);

    session.completePayment({ status: (window as any).ApplePaySession.STATUS_FAILURE });

    await invokeCompletion(
      "onError",
      completionOptions,
      {
        sessionId,
        cardTokenId: "applepay",
        payment: { code: "AUTHORISE_EXCEPTION", error },
      },
      completionHelpers,
      logger
    );
  }
}

function safeUuid(): string
{
  try
  {
    // @ts-ignore - available in modern runtimes
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    {
      // @ts-ignore
      return crypto.randomUUID();
    }
  }
  catch
  {
  }
  return `sdk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}