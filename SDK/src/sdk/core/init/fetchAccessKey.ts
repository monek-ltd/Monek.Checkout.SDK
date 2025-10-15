import { API } from '../../config';

export interface AccessKeyDetails {
  accessKey: string;
  createdAt: string; 
  lastAccessedAt: string; 
  status: 'ACTIVE' | 'INACTIVE' | string; 
  displayName: string;
  applePayEnabled: boolean;
  buid: string;
}

export async function fetchAccessKeyDetails(publicKey: string): Promise<AccessKeyDetails> {
  const url = `${API.base}/key/${publicKey}`;
  const headers = { 'x-api-key': publicKey };

  const response = await fetch(url, { method: 'GET', headers });

  if (!response.ok) {
    throw new Error(`Unable to retrieve access key: ${response.status}`);
  }

  const data = (await response.json()) as unknown;

  if (!isAccessKeyDetails(data)) {
    throw new Error('Unable to retrieve access key: invalid response shape');
  }

  return data;
}

function isAccessKeyDetails(input: unknown): input is AccessKeyDetails {
  if (typeof input !== 'object' || input === null) return false;
  const o = input as Record<string, unknown>;
  return (
    typeof o.accessKey === 'string' &&
    typeof o.createdAt === 'string' &&
    typeof o.lastAccessedAt === 'string' &&
    typeof o.status === 'string' &&
    typeof o.displayName === 'string' &&
    typeof o.applePayEnabled === 'boolean' &&
    typeof o.buid === 'string'
  );
}
