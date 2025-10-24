import React, { useEffect, useMemo, useRef, useCallback } from 'react';
import { API } from '../../sdk/config';
import '../hosted-fields.css';

import { Logger, makeLogger } from '../../sdk/core/utils/Logger';
import type { ConfigureLoggerMessage } from '../../sdk/core/iframe/messages';

/* Constants / Query helpers */

const TOKENISE_TIMEOUT_MS = 20_000;

function getParams() {
    return new URLSearchParams(window.location.search);
}
function getParentOriginParam() {
    return getParams().get('parentOrigin') || '*';
}
function getSessionId() {
    return getParams().get('sessionId') || '';
}
function getPublicKey() {
    return getParams().get('publicKey') || '';
}

/* Logger */

let iframeLogger: Logger = makeLogger('Iframe', false, 'silent');

/* DOM/CSS helpers */

function applyThemeVars(vars: Record<string, string>, logger: Logger) {
    try {
        const root = document.documentElement;
        Object.entries(vars).forEach(([key, value]) => {
            try {
                root.style.setProperty(key, String(value), 'important');
            }
            catch (error) {
                logger.warn('applyThemeVars: failed to set CSS var', { key, value, error: (error as Error)?.message });
            }
        });
        logger.info('applyThemeVars: applied', { count: Object.keys(vars).length });
    }
    catch (error) {
        logger.error('applyThemeVars: unexpected error', { message: (error as Error)?.message });
    }
}

/* PAN/expiry helpers */

function onlyDigits(input: string) {
    return input.replace(/\D+/g, '');
}

function luhn(numberText: string) {
    let sum = 0;
    let doubleDigit = false;
    for (let index = numberText.length - 1; index >= 0; index--) {
        let digit = Number(numberText[index]);
        if (doubleDigit) {
            digit *= 2;
            if (digit > 9) {
                digit -= 9;
            }
        }
        sum += digit;
        doubleDigit = !doubleDigit;
    }
    return sum % 10 === 0;
}

function formatPanGrouped(input: string) {
    const digits = onlyDigits(input).slice(0, 19);
    const groups = digits.match(/.{1,4}/g) || [];
    return groups.join(' ');
}

function formatExpiry(input: string) {
    let value = input.replace(/[^\d]/g, '').slice(0, 4);
    if (value.length >= 3) {
        value = value.slice(0, 2) + '/' + value.slice(2);
    }
    return value;
}

function sanitiseCvc(input: string) {
    return onlyDigits(input).slice(0, 4);
}

function isValidExpiryMMYY(value: string) {
    return /^\d{2}\/\d{2}$/.test(value);
}

/* Fetch helpers */

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    try {
        return await fetch(input, { ...init, signal: abortController.signal });
    }
    finally {
        clearTimeout(timeout);
    }
}

/* Component */

const HostedFieldsApp: React.FC = () => {
    const panRef = useRef<HTMLInputElement>(null);
    const expRef = useRef<HTMLInputElement>(null);
    const cvcRef = useRef<HTMLInputElement>(null);

    const allowedOriginRef = useRef<string>(getParentOriginParam());

    const sessionId = useMemo(getSessionId, []);
    const publicKey = useMemo(getPublicKey, []);

    const tokenise = useCallback(async (): Promise<string> => {
        const panPlain = onlyDigits(panRef.current?.value || '');
        const expiry = (expRef.current?.value || '').trim();
        const cvcPlain = onlyDigits(cvcRef.current?.value || '');

        iframeLogger.debug('tokenise: start', {
            panLength: panPlain.length,
            hasExpiry: Boolean(expiry),
            cvcLength: cvcPlain.length
        });

        if (panPlain.length < 12 || panPlain.length > 19) {
            throw new Error('Invalid card number length');
        }
        if (!luhn(panPlain)) {
            throw new Error('Invalid card number');
        }
        if (!isValidExpiryMMYY(expiry)) {
            throw new Error('Invalid expiry (MM/YY)');
        }
        if (!(cvcPlain.length === 3 || cvcPlain.length === 4)) {
            throw new Error('Invalid CVC');
        }

        const payload = { PAN: panPlain, CVV: cvcPlain, SessionID: sessionId };

        iframeLogger.debug('tokenise: request (redacted)', {
            sessionId,
            panLength: panPlain.length,
            cvcLength: cvcPlain.length
        });

        const timer = iframeLogger.time('tokenise:fetch');
        const response = await fetchWithTimeout(
            `${API.base}/tokenise`,
            {
                method: 'POST',
                headers:
                {
                    'Content-Type': 'application/json',
                    'X-Api-Key': publicKey
                },
                body: JSON.stringify(payload)
            },
            TOKENISE_TIMEOUT_MS
        );
        timer.end({ status: response.status });

        if (!response.ok) {
            throw new Error(`Tokenise failed (${response.status})`);
        }

        const data = await response.json();
        const tokenId = data?.tokenID ?? data?.tokenId ?? data?.TokenID;

        if (!tokenId) {
            throw new Error('Tokenise returned no tokenID');
        }

        iframeLogger.info('tokenise: success');
        return tokenId;
    }, [publicKey, sessionId]);

    useEffect(() => {
        window.parent.postMessage({ type: 'ready' }, allowedOriginRef.current);

        const onMessage = async (event: MessageEvent) => {
            iframeLogger.debug('message: received', { origin: event.origin, type: event?.data?.type });

            if (event?.data?.type === 'PING_FROM_PARENT') {
                allowedOriginRef.current = event.origin;
                iframeLogger.info('handshake: parent origin captured', { origin: event.origin });

                window.parent.postMessage({ type: 'ready' }, allowedOriginRef.current);
                return;
            }

            const allowed = allowedOriginRef.current;
            if (allowed !== '*' && event.origin !== allowed) {
                iframeLogger.warn('message: origin mismatch', { received: event.origin, expected: allowed });
                return;
            }

            const data = event.data || {};

            if (data.type === 'configure' && data.themeVars) {
                applyThemeVars(data.themeVars as Record<string, string>, iframeLogger);
                return;
            }

            if (data.type === 'configureLogger') {
                const msg = data as ConfigureLoggerMessage;
                iframeLogger = makeLogger(msg.namespaceBase ?? 'Iframe', msg.enabled, msg.level)
                    .withStaticContext(msg.sessionId ? { sessionId: msg.sessionId } : {});
                iframeLogger.info('logger configured');
                return;
            }

            if (data.type === 'tokenise') {
                try {
                    const cardToken = await tokenise();
                    window.parent.postMessage({ type: 'tokenised', cardToken }, allowedOriginRef.current);
                }
                catch (error: any) {
                    iframeLogger.error('tokenise: failure', { message: error?.message ?? String(error) });
                    window.parent.postMessage(
                        { type: 'error', code: 'TOKENISE_FAILED', message: error?.message || 'Tokenisation failed' },
                        allowedOriginRef.current
                    );
                }
                return;
            }

            if (data.type === 'getExpiry') {
                try {
                    const expiry = (expRef.current?.value || '').trim();
                    if (!isValidExpiryMMYY(expiry)) {
                        throw new Error('Invalid expiry (MM/YY)');
                    }
                    window.parent.postMessage({ type: 'expiry', expiry }, allowedOriginRef.current);
                }
                catch (error: any) {
                    iframeLogger.error('getExpiry: failure', { message: error?.message ?? String(error) });
                    window.parent.postMessage(
                        { type: 'error', code: 'EXPIRY_FAILED', message: error?.message || 'Expiry retrieval failed' },
                        allowedOriginRef.current
                    );
                }
                return;
            }

            iframeLogger.debug('message: unhandled', { type: data?.type });
        };

        window.addEventListener('message', onMessage, { capture: true });
        return () => window.removeEventListener('message', onMessage, { capture: true });
    }, [tokenise]);

    const handlePanInput = (event: React.ChangeEvent<HTMLInputElement>) => {
        event.target.value = formatPanGrouped(event.target.value);
    };

    const handleExpInput = (event: React.ChangeEvent<HTMLInputElement>) => {
        event.target.value = formatExpiry(event.target.value);
    };

    const handleCvcInput = (event: React.ChangeEvent<HTMLInputElement>) => {
        event.target.value = sanitiseCvc(event.target.value);
    };

    return (
        <div className="hf-root">
            <input
                ref={panRef}
                placeholder="Card Number"
                maxLength={23}
                onChange={handlePanInput}
                inputMode="numeric"
                autoComplete="cc-number"
            />
            <div className="hf-row">
                <input
                    ref={expRef}
                    placeholder="MM/YY"
                    maxLength={5}
                    onChange={handleExpInput}
                    inputMode="numeric"
                    autoComplete="cc-exp"
                />
                <input
                    ref={cvcRef}
                    placeholder="CVC"
                    maxLength={4}
                    onChange={handleCvcInput}
                    inputMode="numeric"
                    autoComplete="cc-csc"
                />
            </div>
        </div>
    );
};

export default HostedFieldsApp;
