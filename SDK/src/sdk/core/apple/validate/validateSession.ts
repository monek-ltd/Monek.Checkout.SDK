import { API } from '../../../config';

export async function validateSession(payload: any) {
    const url = `${API.appleSession}`;
   
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                //'x-api-key': apiKey,
            },
            body: JSON.stringify(payload),
        });

        const text = await response.text();
        let parsed: any = null;
        try { parsed = text ? JSON.parse(text) : null; } catch {}

        return {
            status: response.status.toString(),
            session: parsed,          
            raw: text                   
        };

    } catch (error) {
        console.error("Error during validating merchant: ", error);
    }
}