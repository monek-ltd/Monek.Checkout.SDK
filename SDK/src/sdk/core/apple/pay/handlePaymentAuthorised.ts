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

  logger.info("handlePaymentAuthorised: start", {
    sessionId,
    hasToken: Boolean(event?.payment?.token),
    currencyCode: normalisedCurrencyNumeric,
    countryCode: normalisedCountryNumeric
  });

  const paymentData = event.payment;

  if (!paymentData?.token)
  {
    logger.warn("handlePaymentAuthorised: missing token");
    session.completePayment({ status: (window as any).ApplePaySession.STATUS_FAILURE });

    await invokeCompletion(
      "onError",
      completionOptions,
      { sessionId, cardTokenId: "applepay", payment: { code: "NO_TOKEN" } },
      completionHelpers,
      logger.child("Completion")
    );

    logger.info("handlePaymentAuthorised: end (no token)");
    return;
  }

  try
  {
    let description: string | undefined;
    try
    {
      description = callbacks?.getDescription ? await callbacks.getDescription() : undefined;
    }
    catch (error)
    {
      logger.warn("getDescription() threw; continuing without description", { error: (error as Error)?.message });
    }

    const currentUrl =
      typeof window !== "undefined" && window?.location?.href
        ? window.location.href
        : undefined;

    const source =
      typeof navigator !== "undefined" && navigator?.userAgent
        ? `web:${navigator.userAgent}`
        : "EmbeddedCheckout";

    const idempotencyToken = safeUuid();

    const authoriseBody = {
      sessionId,
      settlementType: (options as any).settlementType ?? "Auto",
      intent: (options as any).intent ?? "Purchase",
      cardEntry: (options as any).cardEntry ?? "ECommerce",
      order: (options as any).order ?? "Checkout",

      currencyCode: normalisedCurrencyNumeric,
      countryCode: normalisedCountryNumeric,

      paymentReference: (options as any).paymentReference ?? undefined,
      idempotencyToken,
      validityId: (options as any).validityId ?? undefined,
      channel: (options as any).channel ?? "Web",
      source,
      sourceIpAddress: (options as any).sourceIpAddress ?? undefined,
      url: currentUrl,
      basketDescription: description,

      token: paymentData.token
    };

    logger.debug("authorise request (redacted)", {
      sessionId,
      settlementType: authoriseBody.settlementType,
      intent: authoriseBody.intent,
      cardEntry: authoriseBody.cardEntry,
      order: authoriseBody.order,
      currencyCode: authoriseBody.currencyCode,
      countryCode: authoriseBody.countryCode,
      paymentReference: authoriseBody.paymentReference,
      idempotencyToken,
      validityId: authoriseBody.validityId,
      channel: authoriseBody.channel,
      hasToken: true,
      tokenTransactionId: paymentData?.token?.transactionIdentifier ?? undefined
    });

    const timer = logger.time("authorisedPayment");
    const paymentResponse = await authorisedPayment(publicKey, authoriseBody);
    timer.end({ result: paymentResponse?.result });

    const approved = String(paymentResponse?.result ?? "").toUpperCase() === "SUCCESS";

    session.completePayment({
      status: approved
        ? (window as any).ApplePaySession.STATUS_SUCCESS
        : (window as any).ApplePaySession.STATUS_FAILURE
    });
    logger.info("session.completePayment called", { approved });

    const completionContext: CompletionContext = {
      sessionId,
      cardTokenId: paymentData?.token?.transactionIdentifier ?? "applepay",
      auth: { applePay: redactedApplePayToken(paymentData?.token) },
      payment: paymentResponse
    };

    await new Promise(resolve => setTimeout(resolve, 150));

    if (approved)
    {
      logger.info("invoking completion.onSuccess");
      await invokeCompletion(
        "onSuccess",
        completionOptions,
        completionContext,
        completionHelpers,
        logger.child("Completion")
      );
    }
    else
    {
      logger.warn("invoking completion.onError (not approved)");
      await invokeCompletion(
        "onError",
        completionOptions,
        completionContext,
        completionHelpers,
        logger.child("Completion")
      );
    }

    logger.info("handlePaymentAuthorised: end", { approved });
  }
  catch (error)
  {
    logger.error("Error during authorising payment", { message: (error as Error)?.message });

    session.completePayment({ status: (window as any).ApplePaySession.STATUS_FAILURE });
    logger.info("session.completePayment called", { approved: false });

    await invokeCompletion(
      "onError",
      completionOptions,
      {
        sessionId,
        cardTokenId: "applepay",
        payment: { code: "AUTHORISE_EXCEPTION", error: (error as Error)?.message ?? String(error) }
      },
      completionHelpers,
      logger.child("Completion")
    );

    logger.info("handlePaymentAuthorised: end (exception)");
  }
}

function redactedApplePayToken(token: any): Record<string, unknown> | undefined
{
  if (!token)
  {
    return undefined;
  }

  const transactionIdentifier = token?.transactionIdentifier ?? undefined;
  const paymentMethodType = token?.paymentMethod?.type ?? undefined;
  const displayName = token?.paymentMethod?.displayName ?? undefined;
  const network = token?.paymentMethod?.network ?? undefined;

  return {
    transactionIdentifier,
    paymentMethod: {
      type: paymentMethodType,
      displayName,
      network
  }
  };
}

function safeUuid(): string
{
  try
  {
    // @ts-ignore - available in modern runtimes
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    {
      // @ts-ignore
      return crypto.randomUUI
