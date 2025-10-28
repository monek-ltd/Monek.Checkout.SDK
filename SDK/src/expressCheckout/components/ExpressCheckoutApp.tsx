import React, { useEffect, useMemo, useCallback, useState, useRef } from "react";

import { Logger, makeLogger } from "../../sdk/core/utils/Logger";
import type { ConfigureLoggerMessage } from "../../sdk/core/iframe/messages";

/* Query / constants / types */

function getParams() {
    return new URLSearchParams(window.location.search);
}

function getParentOriginParam() {
    return getParams().get("parentOrigin") || "*";
}

/* Logger ref */

let iframeLogger: Logger = makeLogger("Iframe", false, "silent");

/* JSX typing for apple button */

declare module "react" {
    namespace JSX {
        interface IntrinsicElements {
            "apple-pay-button": React.DetailedHTMLProps<
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
            canMakePayments: () => boolean;
        };
    }
}

/* Availability utilities */

function isApplePayBrowserAvailable(): boolean {
    try {
        return Boolean(window.ApplePaySession && window.ApplePaySession.canMakePayments());
    }
    catch
    {
        return false;
    }
}

/* Component */

const ExpressCheckoutApp: React.FC = () => {
    const parentOriginParam = useMemo(getParentOriginParam, []);
    const allowedOriginRef = useRef<string>(parentOriginParam);

    const [applePayBrowserAvailable, setApplePayBrowserAvailable] = useState(false);
    const [applePayEnabledByMerchant, setApplePayEnabledByMerchant] = useState(false);

    useEffect(() => {
        const available = isApplePayBrowserAvailable();
        setApplePayBrowserAvailable(available);

        if (available) {
            iframeLogger.info("Apple Pay is available in this browser");

            const btn = document.getElementById('apple-pay-button')
            if (btn) {
                btn.style.display = 'inline-block'
                btn.addEventListener("click", handleApplePayClick)
            }
        }
        else {
            iframeLogger.warn("Apple Pay is NOT available in this browser");
        }
    }, []);

    useEffect(() => {
        window.parent.postMessage({ type: "ready" }, allowedOriginRef.current);

        const onMessage = (event: MessageEvent) => {
            iframeLogger.debug("message: received", {
                origin: event.origin,
                type: event?.data?.type,
            });

            if (event?.data?.type === "PING_FROM_PARENT") {
                allowedOriginRef.current = event.origin;
                iframeLogger.info("handshake: parent origin captured", { origin: event.origin });

                window.parent.postMessage({ type: "ready" }, allowedOriginRef.current);
                return;
            }

            const allowed = allowedOriginRef.current;
            if (allowed !== "*" && event.origin !== allowed) {
                iframeLogger.warn("message: origin mismatch", {
                    receivedOrigin: event.origin,
                    expectedOrigin: allowed,
                });
                return;
            }

            const data = event.data || {};

            if (data.type === "configure") {
                const isEnabled = Boolean((data as any).applePayEnabled);
                setApplePayEnabledByMerchant(isEnabled);
                iframeLogger.info("configure: applePayEnabled updated", { enabled: isEnabled });
                return;
            }

            if (data.type === "configureLogger") {
                const msg = data as ConfigureLoggerMessage;
                iframeLogger = makeLogger(msg.namespaceBase ?? "Iframe", msg.enabled, msg.level)
                    .withStaticContext(msg.sessionId ? { sessionId: msg.sessionId } : {});
                iframeLogger.info("logger configured", { enabled: msg.enabled, level: msg.level });
                return;
            }

            iframeLogger.debug("message: unhandled", { type: data?.type });
        };

        window.addEventListener("message", onMessage, { capture: true });
        return () => window.removeEventListener("message", onMessage, { capture: true });
    }, []);

    const handleApplePayClick = useCallback(() => {
        const allowed = allowedOriginRef.current;

        iframeLogger.info("apple pay button clicked", {
            allowedOrigin: allowed,
            browserAvailable: applePayBrowserAvailable,
            merchantEnabled: applePayEnabledByMerchant,
        });

        if (!applePayBrowserAvailable || !applePayEnabledByMerchant) {
            iframeLogger.warn("apple pay click ignored (not available or not enabled)");
            return;
        }

        window.parent.postMessage({ type: "ap-click" }, allowed);
    }, [applePayBrowserAvailable, applePayEnabledByMerchant]);

    const shouldShowApplePay = applePayBrowserAvailable && applePayEnabledByMerchant;

    return (
        <div
            style={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
                paddingTop: 10,
            }}
        >
            {shouldShowApplePay && (
                <apple-pay-button
                    id="apple-pay-button"
                    buttonstyle="black"
                    type="buy"
                    locale="en-US"
                    style={{
                        WebkitAppearance: "none",
                        width: "225px",
                        height: "55px",
                        borderRadius: "6px",
                        padding: 0,
                        display: "inline-block",
                    }}
                    aria-label="Pay with Apple Pay"
                />
            )}
        </div>
    );
};

export default ExpressCheckoutApp;
