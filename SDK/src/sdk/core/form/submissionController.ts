import type { CheckoutPort } from '../../types/checkout-port';
import { buildCompletionHelpers } from "./submission/buildCompletionHelpers";
import { openSessionWebSocket } from "./submission/openSessionWebSocket";
import { tokeniseAndGetExpiry } from "./submission/requestToken";
import { runThreeDSFlow } from "./submission/threeDSFlow";
import { completeSubmission } from "./submission/completeSubmission";
import { runCompletionHook } from './helpers/runCompletionHook';
import { Logger } from '../utils/Logger';

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
        helpers = buildCompletionHelpers(form);
        helpers.disable();
        debug('helpers disabled');

        try {
            const sessionId = component.getSessionId();
            debug('session acquired', { sessionId });

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
            debug('tokenised', { cardTokenId, expiry });

            if (cancelled) return { status: 'cancel' };

            // 3DS
            const timer3ds = submitLogger.time('3ds');
            const authContext = await runThreeDSFlow(
                component,
                sessionId,
                cardTokenId,
                expiry,
                completionOptions,
                webSocketClient,
                submitLogger.child('ThreeDS')
            );
            timer3ds.end({ result: authContext.authenticationResult?.result });
            debug('3DS flow complete', { result: authContext.authenticationResult?.result });

            if (cancelled) return { status: 'cancel' };

            if (authContext.authenticationResult?.result === 'not-authenticated') {
                submitLogger.warn('not-authenticated; invoking onError if provided');
                if (completionOptions?.onError) {
                    const timerHook = submitLogger.time('completion:onError');
                    await runCompletionHook(
                        completionOptions.onError,
                        { sessionId, cardTokenId, auth: authContext.authenticationResult, payment: null },
                        helpers
                    );
                    timerHook.end();
                    debug('completion onError hook executed');
                } else {
                    submitLogger.error('not-authenticated with no onError hook');
                }
                return { status: 'not-authenticated' };
            }

            // Completion
            submitLogger.info('proceeding to completion', { mode: completionOptions?.mode ?? 'server' });
            const timerComplete = submitLogger.time('completeSubmission');
            await completeSubmission(
                form,
                component,
                completionOptions,
                { sessionId, cardTokenId, expiry, auth: authContext.authenticationResult },
                helpers
            );
            timerComplete.end();
            debug('completion finished');

            return { status: 'success' };
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