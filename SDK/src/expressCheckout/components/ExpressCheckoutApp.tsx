import React, { useEffect, useMemo, useCallback } from 'react'

function getParams() { return new URLSearchParams(window.location.search); }
function getParentOrigin() { return getParams().get('parentOrigin') || '*'; }

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
