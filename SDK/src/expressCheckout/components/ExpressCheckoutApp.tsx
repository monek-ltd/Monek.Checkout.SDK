import React, { useEffect } from 'react'

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
            }
        } else {
            console.log('[ExpressCheckout] Apple Pay not available')
        }
    }, [])

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
