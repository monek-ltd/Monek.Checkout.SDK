import type {
    CompletionOptions,
    CompletionHelpers,
    CompletionContext,
    ApplePayCompletionDetails
} from "../../../types/completion";
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
        settlementType: (options as ApplePayHandlerOptions).settlementType ?? "Auto",
        intent: (options as ApplePayHandlerOptions).intent ?? "Purchase",
        cardEntry: (options as ApplePayHandlerOptions).cardEntry ?? "ECommerce",
        order: (options as ApplePayHandlerOptions).order ?? "Checkout",

      currencyCode: normalisedCurrencyNumeric,
      countryCode: normalisedCountryNumeric,

        paymentReference: (options as ApplePayHandlerOptions).paymentReference ?? undefined,
      idempotencyToken,
        validityId: (options as ApplePayHandlerOptions).validityId ?? undefined,
        channel: (options as ApplePayHandlerOptions).channel ?? "Web",
      source,
        sourceIpAddress: (options as ApplePayHandlerOptions).sourceIpAddress ?? undefined,
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

    const applePayDetails = buildApplePayCompletionDetails(paymentData);

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
      payment: paymentResponse,
      ...(applePayDetails ? { applePay: applePayDetails } : {})
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

function buildApplePayCompletionDetails(payment?: ApplePayJS.ApplePayPayment): ApplePayCompletionDetails | undefined {
    if (!payment) {
        return undefined;
    }

    const paymentWithExtras = payment as ApplePayJS.ApplePayPayment & {
        shippingMethod?: ApplePayJS.ApplePayShippingMethod;
    };

    const billingContact = normaliseApplePayContact(payment.billingContact);
    const shippingContact = normaliseApplePayContact(payment.shippingContact);
    const shippingMethod = normaliseApplePayShippingMethod(paymentWithExtras.shippingMethod);

    const payerEmail = billingContact?.emailAddress ?? shippingContact?.emailAddress ?? undefined;
    const payerPhone = billingContact?.phoneNumber ?? shippingContact?.phoneNumber ?? undefined;
    const payerName = derivePayerName(shippingContact) ?? derivePayerName(billingContact);

    if (
        !billingContact &&
        !shippingContact &&
        !shippingMethod &&
        !payerEmail &&
        !payerPhone &&
        !payerName
    ) {
        return undefined;
    }

    return {
        payerEmail,
        payerPhone,
        payerName,
        billingContact,
        shippingContact,
        shippingMethod,
    };
}

function normaliseApplePayContact(contact?: ApplePayJS.ApplePayPaymentContact): ApplePayCompletionDetails["billingContact"] {
    if (!contact) {
        return undefined;
    }

    const extendedContact = contact as ApplePayJS.ApplePayPaymentContact & {
        middleName?: string;
        subLocality?: string;
        supplementarySubLocality?: string;
        organisationName?: string;
        organizationName?: string;
        phoneticMiddleName?: string;
    };

    const addressLines = Array.isArray(contact.addressLines) && contact.addressLines.length > 0
        ? [...contact.addressLines]
        : undefined;

    const organisationName =
        extendedContact.organisationName ??
        extendedContact.organizationName ??
        undefined;

    const summary = {
        emailAddress: contact.emailAddress ?? undefined,
        phoneNumber: contact.phoneNumber ?? undefined,
        givenName: contact.givenName ?? undefined,
        familyName: contact.familyName ?? undefined,
        middleName: extendedContact.middleName ?? undefined,
        phoneticGivenName: contact.phoneticGivenName ?? undefined,
        phoneticFamilyName: contact.phoneticFamilyName ?? undefined,
        phoneticMiddleName: extendedContact.phoneticMiddleName ?? undefined,
        organisationName,
        addressLines,
        locality: contact.locality ?? undefined,
        subLocality: extendedContact.subLocality ?? contact.subLocality ?? undefined,
        supplementarySubLocality: extendedContact.supplementarySubLocality ?? undefined,
        postalCode: contact.postalCode ?? undefined,
        administrativeArea: contact.administrativeArea ?? undefined,
        subAdministrativeArea: contact.subAdministrativeArea ?? undefined,
        country: contact.country ?? undefined,
        countryCode: contact.countryCode ?? undefined,
    } satisfies ApplePayCompletionDetails["billingContact"];

    const hasValue = Object.values(summary).some(value => {
        if (Array.isArray(value)) {
            return value.length > 0;
        }

        return value !== undefined && value !== null && value !== "";
    });

    return hasValue ? summary : undefined;
}

function normaliseApplePayShippingMethod(
    method?: ApplePayJS.ApplePayShippingMethod
): ApplePayCompletionDetails["shippingMethod"] {
    if (!method) {
        return undefined;
    }

    const extendedMethod = method as ApplePayJS.ApplePayShippingMethod & {
        type?: string;
    };

    const summary = {
        amount: method.amount ?? undefined,
        label: method.label ?? undefined,
        detail: method.detail ?? undefined,
        identifier: method.identifier ?? undefined,
        type: extendedMethod.type ? String(extendedMethod.type) : undefined,
    } satisfies ApplePayCompletionDetails["shippingMethod"];

    const hasValue = Object.values(summary).some(value => value !== undefined && value !== null && value !== "");

    return hasValue ? summary : undefined;
}

function derivePayerName(contact?: ApplePayCompletionDetails["billingContact"]): string | undefined {
    if (!contact) {
        return undefined;
    }

    const parts = [contact.givenName, contact.middleName, contact.familyName].filter(Boolean) as string[];

    if (parts.length > 0) {
        return parts.join(" ");
    }

    if (contact.organisationName) {
        return contact.organisationName;
    }

    return undefined;
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
       return crypto.randomUUID();
    }
  }
  catch
  {
  }
  return `sdk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}