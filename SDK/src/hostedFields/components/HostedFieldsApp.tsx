import React, { useEffect, useMemo, useRef, useCallback } from 'react'
import { API } from '../../sdk/config';


function getParams() { return new URLSearchParams(window.location.search); }
function getParentOrigin() { return getParams().get('parentOrigin') || '*'; }
function getSessionId() { return getParams().get('sessionId') || ''; }
function getPublicKey() { return getParams().get('publicKey') || ''; }


const HostedFieldsApp: React.FC = () => {
    const panRef = useRef<HTMLInputElement>(null);
    const expRef = useRef<HTMLInputElement>(null);
    const cvcRef = useRef<HTMLInputElement>(null);

    const parentOrigin = useMemo(getParentOrigin, []);
    const sessionId = useMemo(getSessionId, []);
    const publicKey = useMemo(getPublicKey, []);

    const onlyDigits = (s: string) => s.replace(/\D+/g, '');
    const luhn = (num: string) => {
        let sum = 0, dbl = false;
        for (let i = num.length - 1; i >= 0; i--) {
            let d = Number(num[i]);
            if (dbl) { d *= 2; if (d > 9) d -= 9; }
            sum += d; dbl = !dbl;
        }
        return sum % 10 === 0;
    };

    // --- tokenise stub ---
    const tokenise = useCallback(async (): Promise<string> => {
        const pan = onlyDigits(panRef.current?.value || '');
        const exp = (expRef.current?.value || '').trim();
        const cvc = onlyDigits(cvcRef.current?.value || '');

        // basic validation todo:improve
        if (pan.length < 12 || pan.length > 19) throw new Error('Invalid card number length');
        if (!luhn(pan)) throw new Error('Invalid card number');
        if (!/^\d{2}\/\d{2}$/.test(exp)) throw new Error('Invalid expiry (MM/YY)');
        if (!(cvc.length === 3 || cvc.length === 4)) throw new Error('Invalid CVC');

        // === Tokenise ===
        const res = await fetch(`${API.base}/tokenise`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': publicKey,
            },
            body: JSON.stringify({ PAN: pan, CVV: cvc, SessionID: sessionId }),
        });
        if(!res.ok) throw new Error(`Tokenise failed (${res.status})`);
        const data = await res.json();

        return data.tokenID;
    }, [sessionId]);

    // --- message handler: respond to parent requests ---
    useEffect(() => {
        // Announce readiness
        window.parent.postMessage({ type: 'ready' }, parentOrigin);

        const onMessage = async (evt: MessageEvent) => {
            console.log('[iframe] got message:', { origin: evt.origin, data: evt.data });
            // Strict origin check unless we’re in dev fallback '*'
            if (parentOrigin !== '*' && evt.origin !== parentOrigin) return;

            const data = evt.data || {};
            if (data.type === 'tokenise') {
                try {
                    const cardToken = await tokenise();
                    window.parent.postMessage({ type: 'tokenised', cardToken }, parentOrigin);
                } catch (err: any) {
                    window.parent.postMessage({
                        type: 'error',
                        code: 'TOKENISE_FAILED',
                        message: err?.message || 'Tokenisation failed'
                    }, parentOrigin);
                }
            }
        };

        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [parentOrigin, tokenise]);

    // --- light formatting helpers (optional niceties) ---
    const handlePanInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        // group digits (#### #### #### #### ###)
        const digits = e.target.value.replace(/\D+/g, '').slice(0, 19);
        const groups = digits.match(/.{1,4}/g) || [];
        e.target.value = groups.join(' ');
    };

    const handleExpInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        let v = e.target.value.replace(/[^\d]/g, '').slice(0, 4);
        if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
        e.target.value = v;
    
    };

    const handleCvcInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.target.value = e.target.value.replace(/\D+/g, '').slice(0, 4);
    };

    return (
        <div style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', gap: 8 }}>
            <input ref={panRef} placeholder="Card Number" maxLength={23} onChange={handlePanInput} inputMode="numeric" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input ref={expRef} placeholder="MM/YY" maxLength={5} onChange={handleExpInput} inputMode="numeric" />
                <input ref={cvcRef} placeholder="CVC" maxLength={4} onChange={handleCvcInput} inputMode="numeric" />
            </div>
        </div>
    )
}

export default HostedFieldsApp
