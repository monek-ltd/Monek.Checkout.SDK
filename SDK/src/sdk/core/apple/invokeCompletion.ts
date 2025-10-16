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
    logger.debug("invokeCompletion: no hook for key", { key: String(key) });
    return;
  }

  logger.info("invokeCompletion: start", { key: String(key), context });

  const timer = logger.time(`completion:${String(key)}`);

  try
  {
    await runCompletionHook(hook as CompletionHook, context, helpers);
    timer.end();
    logger.info("invokeCompletion: success", { key: String(key) });
  }
  catch (error)
  {
    timer.end({ error: (error as Error)?.message ?? String(error) });
    logger.error("invokeCompletion: error", {
      key: String(key),
      message: (error as Error)?.message ?? String(error)
    });
  }
}
