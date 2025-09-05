import { API } from '../../config';

export async function fetchAccessKeyDetails(publicKey: string) {
    const response = await fetch(`${API.base}/key/${publicKey}`, {
        method: 'GET',
        headers: {
            'x-api-key': publicKey,
        }
    });
    if (!response.ok) {
        throw new Error(`Unable to retrieve access key: ${response.status}`);
    }

    return await response.json();
}