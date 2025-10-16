import { validateSession } from "./validateSession";
import { Logger } from "../../utils/Logger";

type ValidateSessionParams = {
  session: any;
  event: ApplePayJS.ApplePayValidateMerchantEvent;
  publicKey: string;
  displayName: string;
  logger: Logger;
};

export async function handleValidateSession(params: ValidateSessionParams): Promise<void>
{
  const { session, event, publicKey, displayName, logger } = params;

  const payload = {
    validationURL: event.validationURL,
    displayName,
    parentUrl: document.location.hostname,
    merchantRef: publicKey,
    version: "V2",
  };

  logger.debug("Session validation payload", payload);

  const merchantSession = await validateSession(payload);

  if (merchantSession?.status === "200")
  {
    logger.debug(`Validation status ${merchantSession?.status}`);
    const appleSession = (merchantSession as any).session ?? merchantSession;
    session.completeMerchantValidation(appleSession);
    logger.debug("Session validation complete");
  }
  else
  {
    logger.error(`Session could not be validated : ${merchantSession?.status}`);
  }
}