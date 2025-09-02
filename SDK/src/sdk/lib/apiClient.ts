export async function apiFetch(
  input: RequestInfo,
  init: RequestInit = {}
): Promise<Response> {
  const apiKey = import.meta.env.VITE_API_KEY;

  const headers = {
    ...(init.headers || {}),
    "Content-Type": "application/json",
    "x-api-key": apiKey,
  };

  return fetch(input, { ...init, headers });
}