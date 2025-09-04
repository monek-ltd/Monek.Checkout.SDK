import React, { useEffect } from 'react'
import { applePayEventHandler } from '../../sdk/lib/applePayEventHandler';

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

    // we can get the entire form through method as arg
    const handleApplePayClick = () => {
        console.log("Apple Pay button clicked");

        if (!window.ApplePaySession) {
            return;
        }

        applePayEventHandler();
    }

    return (
        <div style={{ padding: '10px' }}>
            <apple-pay-button
                id="apple-pay-button"
                buttonstyle="black"
                type="buy"
                locale="en-US"
                style={{
                    display: 'none',
                    WebkitAppearance: 'none',
                    width: '180px',
                    height: '40px',
                    borderRadius: '6px',
                    padding: 0,
                }}
            ></apple-pay-button>
        </div>
    )
}

export default ExpressCheckoutApp
