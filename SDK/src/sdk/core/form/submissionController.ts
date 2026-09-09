import type { CheckoutPort } from '../../types/checkout-port';
import { buildCompletionHelpers } from "./submission/buildCompletionHelpers";
import { openSessionWebSocket } from "./submission/openSessionWebSocket";
import { tokeniseAndGetExpiry } from "./submission/requestToken";
import { runThreeDSFlow } from "./submission/threeDSFlow";
import { completeSubmission } from "./submission/completeSubmission";
import { runCompletionHook } from './helpers/runCompletionHook';
import { Logger } from '../utils/Logger';
import { isSessionExpiredError } from '../errors/sessionExpired';

export type SubmissionOutcome =
    | { status: 'success' }
    | { status: 'not-authenticated' }
    | { status: 'error'; message?: string }
    | { status: 'cancel' };

export function setupSubmissionController(
    form: HTMLFormElement,
    component: CheckoutPort,
    logger: Logger
) {
    const submitLogger = logger.child('Submit');
    let isSubmitting = false;
    let boundHandler: ((e: SubmitEvent) => void) | undefined;

    let helpers: ReturnType<typeof buildCompletionHelpers> | null = null;
    let webSocketClient: any | null = null;
    let cancelled = false;

    const debug = (m: string, d?: unknown) => submitLogger.debug(m, d ?? undefined);

    // Runs the WS + tokenise + 3DS + completion pipeline for a given sessionId. Extracted so
    // runOnce() can retry it exactly once with a freshly-minted sessionId if the backend
    // session expired mid-attempt (401 from tokenise, 3DS, or payment).
    async function attemptSubmission(
        sessionId: string,
        completionOptions: ReturnType<CheckoutPort['getCompletionOptions']>
    ): Promise<SubmissionOutcome> {
        // Close any socket left over from a prior (failed) attempt before opening a new one.
        try { webSocketClient?.close(); } catch { /* ignore */ }
        webSocketClient = null;

        // WS
        const timerWs = submitLogger.time('websocket');
        try {
            webSocketClient = await openSessionWebSocket(sessionId, submitLogger.child('WebSocket'));
            timerWs.end({ connected: Boolean(webSocketClient) });
            debug('websocket initialised', { connected: Boolean(webSocketClient) });
        } catch (wsError) {
            timerWs.end({ error: (wsError as Error)?.message });
            submitLogger.warn('websocket failed to open; continuing without it', { message: (wsError as Error)?.message });
        }

        // Tokenise
        const timerTokenise = submitLogger.time('tokenise');
        const { cardTokenId, expiry } = await tokeniseAndGetExpiry(component);
        timerTokenise.end();
        debug('tokenised', { hasCardTokenId: Boolean(cardTokenId), expiry });

        if (cancelled) return { status: 'cancel' };

        // 3DS
        const timer3ds = submitLogger.time('3ds');
        const authContext = await runThreeDSFlow(
            component,
            sessionId,
            cardTokenId,
            expiry,
            webSocketClient,
            submitLogger.child('ThreeDS')
        );
        timer3ds.end({ result: authContext.authenticationResult?.result });
        debug('3DS flow complete', { result: authContext.authenticationResult?.result });

        if (cancelled) return { status: 'cancel' };

        if (authContext.authenticationResult?.result === 'cancelled') {
            // User closed the challenge or it timed out. Dispatch onCancel/onClosed once, with
            // the real completion helpers. threeDSFlow no longer invokes the hook itself.
            const hook = completionOptions?.onCancel ?? completionOptions?.onClosed;
            if (hook) {
                const timerHook = submitLogger.time('completion:onCancel');
                await runCompletionHook(
                    hook,
                    { sessionId, cardTokenId, auth: authContext.authenticationResult, payment: null },
                    helpers!
                );
                timerHook.end();
                debug('completion onCancel/onClosed hook executed');
                return { status: 'cancel' };
            }
            submitLogger.warn('challenge cancelled with no onCancel/onClosed hook; throwing');
            throw new Error('3DS challenge cancelled');
        }

        if (authContext.authenticationResult?.result === 'not-authenticated') {
            submitLogger.warn('not-authenticated; invoking onError if provided');
            if (completionOptions?.onError) {
                const timerHook = submitLogger.time('completion:onError');
                await runCompletionHook(
                    completionOptions.onError,
                    { sessionId, cardTokenId, auth: authContext.authenticationResult, payment: null },
                    helpers!
                );
                timerHook.end();
                debug('completion onError hook executed');
            } else {
                submitLogger.error('not-authenticated with no onError hook');
            }
            return { status: 'not-authenticated' };
        }

        // Completion
        submitLogger.info('proceeding to completion', { mode: completionOptions?.mode ?? 'form' });
        const timerComplete = submitLogger.time('completeSubmission');
        await completeSubmission(
            form,
            component,
            completionOptions,
            { sessionId, cardTokenId, expiry, auth: authContext.authenticationResult },
            helpers!,
            submitLogger
        );
        timerComplete.end();
        debug('completion finished');

        return { status: 'success' };
    }

    async function runOnce(): Promise<SubmissionOutcome> {
        if (isSubmitting) {
            debug('blocked: already submitting');
            return { status: 'error', message: 'Already submitting' };
        }
        isSubmitting = true;
        cancelled = false;

        submitLogger.info('start');
        const timerOverall = submitLogger.time('overall');

        const completionOptions = component.getCompletionOptions();
        helpers = buildCompletionHelpers(form, submitLogger);
        helpers.disable();
        debug('helpers disabled');

        try {
            const sessionId = component.getSessionId();
            debug('session acquired', { hasSessionId: Boolean(sessionId) });

            try {
                return await attemptSubmission(sessionId, completionOptions);
            } catch (error) {
                if (cancelled) return { status: 'cancel' };

                if (!isSessionExpiredError(error)) {
                    throw error;
                }

                submitLogger.warn('session expired mid-submission; refreshing session and retrying once', {
                    message: (error as Error)?.message
                });

                let refreshedSessionId: string;
                try {
                    refreshedSessionId = await component.refreshSession();
                } catch (refreshError) {
                    submitLogger.error('session refresh failed; surfacing original error', {
                        message: (refreshError as Error)?.message
                    });
                    throw error;
                }

                if (cancelled) return { status: 'cancel' };

                debug('session refreshed; retrying submission', { hasSessionId: Boolean(refreshedSessionId) });
                return await attemptSubmission(refreshedSessionId, completionOptions);
            }
        } catch (error) {
            submitLogger.error('submission error', { message: (error as Error)?.message });
            debug('error caught', { message: (error as Error)?.message });
            return cancelled ? { status: 'cancel' } : { status: 'error', message: (error as Error)?.message };
        } finally {
            try { helpers?.reenable(); debug('helpers reenabled'); } catch { submitLogger.warn('helpers.reenable threw (ignored)'); }
            try { webSocketClient?.close(); debug('websocket closed'); } catch { submitLogger.warn('websocket close failed (ignored)'); }

            timerOverall.end();
            submitLogger.info('end');
            isSubmitting = false;
        }
    }

    function attach() {
        if (boundHandler) return;
        boundHandler = (event: SubmitEvent) => { event.preventDefault(); void runOnce(); };
        form.addEventListener('submit', boundHandler, { capture: true });
        submitLogger.debug('listener attached');
    }

    function unbind() {
        if (!boundHandler) return;
        form.removeEventListener('submit', boundHandler, { capture: true } as any);
        boundHandler = undefined;
        submitLogger.debug('listener removed');
    }

    function cancel(): void {
        cancelled = true;
        try { helpers?.reenable(); } catch { }
        try { webSocketClient?.close(); } catch { }
        submitLogger.info('cancel requested');
    }

    return {
        trigger: runOnce,
        attach,
        unbind,
        cancel,
        isBusy: () => isSubmitting,
    };
}
