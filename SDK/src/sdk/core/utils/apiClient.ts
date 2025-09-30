export async function apiFetch(
  input: RequestInfo,
  init: RequestInit = {}
): Promise<Response> {
  const apiKey = ""; // Replace with the actual API key

  const headers = {
    ...(init.headers || {}),
    "Content-Type": "application/json",
    "x-api-key": apiKey,
  };

  return fetch(input, { ...init, headers });
}