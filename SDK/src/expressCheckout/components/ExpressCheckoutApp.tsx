import React, { useEffect, useMemo, useCallback } from 'react'

import { Logger, makeLogger } from '../../sdk/core/utils/Logger';
import type { ConfigureLoggerMessage } from '../../sdk/core/iframe/messages';

function getParams() { return new URLSearchParams(window.location.search); }
function getParentOrigin() { return getParams().get('parentOrigin') || '*'; }

let iframeLogger: Logger = makeLogger('Iframe', false, 'silent');

declare module 'react' {
    namespace JSX {
        interface IntrinsicElements {
            'apple-pay-button': React.DetailedHTMLProps<
                React.HTMLAttributes<HTMLElement>,
                HTMLElement
            > & {
                buttonstyle?: string;
                type?: string;
                locale?: string;
            };
        }
    }
}

declare global {
    interface Window {
        ApplePaySession?: {
            canMakePayments: () => boolean
        }
    }
}

const ExpressCheckoutApp: React.FC = () => {
    const parentOrigin = useMemo(getParentOrigin, []);

    useEffect(() => {
        if (window.ApplePaySession && window.ApplePaySession.canMakePayments()) {
            console.log('[ExpressCheckout] Apple Pay is available')
            const btn = document.getElementById('apple-pay-button')
            if (btn) {
                btn.style.display = 'inline-block'
                btn.addEventListener("click", handleApplePayClick)
            }
        } else {
            console.log('[ExpressCheckout] Apple Pay not available')
        }
    }, [])

     useEffect(() => {
        // Announce readiness
        window.parent.postMessage({ type: 'ready' }, parentOrigin);

        const onMessage = async (evt: MessageEvent) => {
            iframeLogger.debug('Got message:', { origin: evt.origin, data: evt.data });
            // Strict origin check unless we’re in dev fallback '*'
            if (parentOrigin !== '*' && evt.origin !== parentOrigin) {
                iframeLogger.error('origin mismatch');
                return;
            }

            const data = evt.data || {}; 
            
            if (data.type === 'configure' && data.themeVars) {
                //TODO
            }
            else if (data.type === 'configureLogger') {
                const msg = data as ConfigureLoggerMessage;
                iframeLogger = makeLogger(msg.namespaceBase ?? 'Iframe', msg.enabled, msg.level)
                    .withStaticContext(msg.sessionId ? { sessionId: msg.sessionId } : {});
                iframeLogger.info('logger configured');
            }
        };

        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [parentOrigin]);

    const handleApplePayClick = useCallback(() => {
        window.parent.postMessage({ type: 'ap-click' }, parentOrigin);
    }, [parentOrigin]);

    return (
        <div style={{
            height: '100%',                 
            display: 'flex',
            alignItems: 'center',           
            justifyContent: 'center',
            padding: 0,
            paddingTop: 10,
        }}>
            <apple-pay-button
                id="apple-pay-button"
                buttonstyle="black"
                type="buy"
                locale="en-US"
                style={{
                    display: 'none',
                    WebkitAppearance: 'none',
                    width: '225px',
                    height: '55px',
                    borderRadius: '6px',
                    padding: 0,
                }}
            ></apple-pay-button>
        </div>
    )
}

export default ExpressCheckoutApp
