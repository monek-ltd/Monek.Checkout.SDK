import { API } from '../../../config';
import type { Logger } from '../../utils/Logger';

export async function validateSession(payload: any, logger: Logger) {
    const url = `${API.appleSession}`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        const text = await response.text();
        let parsed: any = null;
        try { parsed = text ? JSON.parse(text) : null; } catch { }

        return {
            status: response.status.toString(),
            session: parsed,
            raw: text
        };

    } catch (error) {
        logger.error("Error during validating merchant: ", error);
    }
}
