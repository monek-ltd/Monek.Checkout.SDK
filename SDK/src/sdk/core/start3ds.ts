import { API } from '../config';
import type { ThreeDSMethodPayload } from '../types/three-ds';

export async function start3DS(apiKey: string, cardTokenId: string, sessionId: string): Promise<ThreeDSMethodPayload> {
    const res = await fetch(`${API.base}/3ds`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
        },
        body: JSON.stringify({
            CardTokenID: cardTokenId,
            SessionID: sessionId,
        }),
    });
    if (!res.ok) throw new Error(`3DS start failed (${res.status})`);
    const j = await res.json();

    const payload: ThreeDSMethodPayload = {
        sessionId: j.SessionID ?? j.sessionId,
        threeDSRequest: {
            scheme: j.ThreeDSRequest?.Scheme ?? j.threeDSRequest?.scheme,
            methodUrl: j.ThreeDSRequest?.MethodUrl ?? j.threeDSRequest?.methodUrl,
            methodData: j.ThreeDSRequest?.MethodData ?? j.threeDSRequest?.methodData,
        },
    };
    return payload;
}
