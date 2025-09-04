// import { useContext } from 'react';
import { API } from '../config';
import { apiFetch } from "../lib/apiClient";

export async function authorisedPayment(payload: any) {
    const url = `${API.base}/payment/apple-pay`;
   
    const response = await apiFetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    return await response.json();
}