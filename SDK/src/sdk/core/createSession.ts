import { API } from '../config';

export async function createSession(apiKey: string): Promise<string> {
    const res = await fetch(`${API.base}/session`, {
        method: 'POST',
        headers: { 'x-api-key': apiKey },
    })
    if (!res.ok) throw new Error(`Create session failed (${res.status})`);
    const data = await res.json();

    return data.sessionId;
}