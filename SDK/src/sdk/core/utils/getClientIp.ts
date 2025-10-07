export async function getClientIpViaIpify(timeoutMs = 1500): Promise<string | undefined> {
  const fetchWithTimeout = (url: string) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    return fetch(url, { cache: 'no-store', signal: c.signal })
      .finally(() => clearTimeout(t));
  };

  try {
    let r = await fetchWithTimeout('https://api.ipify.org?format=json');
    if (r.ok) {
      const j = await r.json();
      if (typeof j?.ip === 'string') return j.ip;
    }
    r = await fetchWithTimeout('https://api64.ipify.org?format=json');
    if (r.ok) {
      const j = await r.json();
      if (typeof j?.ip === 'string') return j.ip;
    }
  } catch { }
  return undefined;
}
