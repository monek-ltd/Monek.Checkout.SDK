import type { CompletionHook, CompletionContext, CompletionHelpers, Redirect } from '../../../types/completion';

export async function runCompletionHook(
    hook: CompletionHook | undefined,
    ctx: CompletionContext,
    helpers: CompletionHelpers
) {
    if (!hook) {
        return 'noop';
    }

    // Redirect object > auto-redirect
    if (typeof hook !== 'function') {
        helpers.redirect(hook);
        return 'redirected';
    }

    // Function > call with ctx + helpers; user can do anything
    const out = await hook(ctx, helpers);

    // Convenience: if they *return* a URL or Redirect, we’ll redirect for them.
    if (typeof out === 'string') {
        helpers.redirect(out);
        return 'redirected';
    }

    if (out && typeof out === 'object' && 'url' in (out as Redirect)) {
        helpers.redirect(out as Redirect);
        return 'redirected';
    }

    // Otherwise, assume they handled everything.
    return 'handled';
}
