import { API } from '../../config';
import { collectBrowserInformation } from '../utils/collectBrowserData';
import type { ThreeDSAuthenticationPayload } from '../../types/three-ds-payloads';
import type { InitCallbacks } from '../../types/callbacks';

export async function authenticate(apiKey: string, cardTokenId: string, sessionId: string, callbacks: InitCallbacks, expiry: string): Promise<ThreeDSAuthenticationPayload> {
    
    const res = await fetch(`${API.base}/3ds/authenticate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
        },
        body: JSON.stringify(await buildAuthenticationRequest(cardTokenId, sessionId, callbacks, expiry)),
    });
    if (!res.ok) throw new Error(`3DS authenticate failed (${res.status})`);
    const j = await res.json();

    const payload: ThreeDSAuthenticationPayload = {
        result: j.Result ?? j.result,
        errorMessage: j.ErrorMessage ?? j.errorMessage,
        scheme: j.Scheme ?? j.scheme,
        protocolVersion: j.ProtocolVersion ?? j.protocolVersion,
        serverTransactionId: j.ServerTransactionID ?? j.serverTransactionID, //TODO REMOVE
        challenge: {
            cReq: j.Challenge?.CReq ?? j.challenge?.cReq,
            acsUrl: j.Challenge?.AcsUrl ?? j.challenge?.acsUrl,
        },
    };
    return payload;
}

async function buildAuthenticationRequest(cardTokenId: string, sessionId: string, callbacks: InitCallbacks, expiry: string) {
    
    const amount = 
        callbacks?.getAmount 
            ? await callbacks.getAmount() 
            : undefined;

    if (!amount) { 
        throw new Error('Missing amount: pass in or provide getAmount()');
    }

    const cardholderInformation =
      callbacks?.getCardholderDetails
        ? await callbacks.getCardholderDetails()
        : undefined;

    if (!cardholderInformation) {
        throw new Error('Missing cardholder information: pass in or provide getCardholderDetails()');
    }

    const description =     
        callbacks?.getDescription
            ? await callbacks.getDescription()
            : undefined;

    if (!description) {
        throw new Error('Missing description: pass in or provide getDescription()');
    }

    const expiryMonth = expiry.split('/')[0];
    const expiryYear = expiry.split('/')[1];

    const browserData = await collectBrowserInformation();

    return {
      sessionId,
      cardTokenId,
      amount,                                  
      intent: 'purchase',
      cardholderInformation,                
      browserInformation: browserData,
      description,
      cardExpiryMonth: expiryMonth,
      cardExpiryYear: expiryYear,
    };
}