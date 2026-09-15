const MAX_URL_LENGTH = 2048;

/**
 * Strips the query string (and fragment) from a page URL before it is forwarded to the
 * payment gateway. Query parameters (e.g. ad/analytics click ids such as gclid, _gl,
 * fbclid, utm_*) have caused downstream XML parsing failures and carry no relevance to
 * the payment. Falls back to the original URL if it cannot be parsed, and enforces a
 * maximum length as a final safety net.
 */
export function sanitiseUrl(rawUrl: string | undefined): string | undefined
{
  if (!rawUrl)
  {
    return rawUrl;
  }

  let sanitised = rawUrl;

  try
  {
    const url = new URL(rawUrl);
    url.search = "";
    url.hash = "";

    sanitised = url.toString();
  }
  catch
  {
    // Not a parseable absolute URL; fall back to the raw value untouched.
    sanitised = rawUrl;
  }

  if (sanitised.length > MAX_URL_LENGTH)
  {
    sanitised = sanitised.slice(0, MAX_URL_LENGTH);
  }

  return sanitised;
}
