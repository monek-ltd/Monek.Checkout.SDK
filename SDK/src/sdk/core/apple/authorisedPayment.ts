import { API } from '../../config';

export async function authorisedPayment(apiKey: string, payload: any) {
    const url = `${API.base}/payment/apple-pay`;
   
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            'x-api-key': apiKey,
        },
        body: JSON.stringify(payload),
    });

    return await response.json();
}