import { API } from '../../config';

export async function validateMerchantDomain(payload: any) {
    const url = `${API.appleSession}`;
   
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ payload }),
        });

        let respJson = await response.json();

        let merchantSession = {
            status: response.status.toString(),
            session: respJson
        }

        return merchantSession;

    } catch (error) {
        console.error("Error during validating merchant: ", error);
    }
}