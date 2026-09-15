// Query string params added by ad/analytics platforms (Google Ads, Google Analytics,
// Facebook, Microsoft Ads, TikTok, LinkedIn, Mailchimp, etc). These can contain
// characters/length that some downstream (XML-based) services fail to parse, and they
// carry no value for payment processing, so we strip them before sending the page URL
// to the gateway.
const TRACKING_PARAM_PATTERNS: RegExp[] = [
  /^gclid$/i,
  /^gclsrc$/i,
  /^dclid$/i,
  /^gbraid$/i,
  /^wbraid$/i,
  /^fbclid$/i,
  /^msclkid$/i,
  /^twclid$/i,
  /^ttclid$/i,
  /^li_fat_id$/i,
  /^mc_[a-z]+$/i,
  /^_ga$/i,
  /^_gl$/i,
  /^utm_[a-z]+$/i
];

const MAX_URL_LENGTH = 2048;

function isTrackingParam(name: string): boolean
{
  return TRACKING_PARAM_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Removes known ad/analytics click-id and tracking query parameters (gclid, _gl, fbclid,
 * utm_*, etc.) from a page URL before it is forwarded to the payment gateway. These
 * parameters have caused downstream XML parsing failures and have no relevance to the
 * payment. Falls back to the original URL if it cannot be parsed, and enforces a maximum
 * length as a final safety net.
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
    const paramsToRemove: string[] = [];

    url.searchParams.forEach((_value, name) =>
    {
      if (isTrackingParam(name))
      {
        paramsToRemove.push(name);
      }
    });

    paramsToRemove.forEach((name) => url.searchParams.delete(name));

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
