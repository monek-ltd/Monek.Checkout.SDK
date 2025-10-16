import type { CompletionOptions, CompletionHelpers, CompletionContext, CompletionHook } from "../../types/completion";
import { runCompletionHook } from "../form/helpers/runCompletionHook";
import { Logger } from "../utils/Logger";

export async function invokeCompletion<K extends keyof CompletionOptions>(
  key: K,
  completionOptions: CompletionOptions | undefined,
  context: CompletionContext,
  helpers: CompletionHelpers,
  logger: Logger
): Promise<void>
{
  const hook = completionOptions?.[key];
  if (!hook)
  {
    return;
  }
  try
  {
    await runCompletionHook(hook as CompletionHook, context, helpers);
  }
  catch (error)
  {
    logger.error(`Invoke completion ${String(key)} threw`, error);
  }
}