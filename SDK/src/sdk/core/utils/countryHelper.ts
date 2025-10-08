import type { CountryCode } from '../../types/transaction-details';

type CountryEntry = { a2: string; a3: string; n3: string };

/**
 * Minimal ISO 3166-1 index (extend as needed).
 * a2 = alpha-2, a3 = alpha-3, n3 = numeric (zero-padded 3 digits)
 */
const COUNTRY_INDEX: CountryEntry[] = [
  { a2: 'GB', a3: 'GBR', n3: '826' },
  { a2: 'US', a3: 'USA', n3: '840' },
  { a2: 'FR', a3: 'FRA', n3: '250' },
  { a2: 'JP', a3: 'JPN', n3: '392' },
  { a2: 'DE', a3: 'DEU', n3: '276' },
  { a2: 'CA', a3: 'CAN', n3: '124' },
  { a2: 'AU', a3: 'AUS', n3: '036' },
  { a2: 'IE', a3: 'IRL', n3: '372' },
  { a2: 'NL', a3: 'NLD', n3: '528' },
  { a2: 'IT', a3: 'ITA', n3: '380' },
  { a2: 'ES', a3: 'ESP', n3: '724' },
  { a2: 'SE', a3: 'SWE', n3: '752' },
  { a2: 'NO', a3: 'NOR', n3: '578' },
  { a2: 'DK', a3: 'DNK', n3: '208' },
  { a2: 'FI', a3: 'FIN', n3: '246' },
  { a2: 'NZ', a3: 'NZL', n3: '554' },
  { a2: 'AT', a3: 'AUT', n3: '040' },
  { a2: 'BE', a3: 'BEL', n3: '056' },
  { a2: 'CH', a3: 'CHE', n3: '756' },
  { a2: 'SG', a3: 'SGP', n3: '702' },
  { a2: 'HK', a3: 'HKG', n3: '344' },
  { a2: 'AE', a3: 'ARE', n3: '784' },
  { a2: 'BR', a3: 'BRA', n3: '076' },
  { a2: 'MX', a3: 'MEX', n3: '484' },
  { a2: 'ZA', a3: 'ZAF', n3: '710' },
  { a2: 'CN', a3: 'CHN', n3: '156' },
  { a2: 'IN', a3: 'IND', n3: '356' },
];

const CTY_BY_A2: Record<string, CountryEntry> = Object.create(null);
const CTY_BY_A3: Record<string, CountryEntry> = Object.create(null);
const CTY_BY_N3: Record<string, CountryEntry> = Object.create(null);
for (const e of COUNTRY_INDEX) {
  CTY_BY_A2[e.a2] = e;
  CTY_BY_A3[e.a3] = e;
  CTY_BY_N3[e.n3] = e;
}

/**
 * normalise a country code to { alpha2, numeric }.
 * Accepts alpha-2 ("GB"), alpha-3 ("GBR"), or numeric ("826" / 826).
 * If unknown, returns best-effort with empty string for the missing part(s).
 */
export function normaliseCountry(code: CountryCode): { alpha2: string; numeric: string } {
  const raw = String(code).trim();
  const upper = raw.toUpperCase();
  const digitsOnly = upper.replace(/\D+/g, '');

  let entry: CountryEntry | undefined;

  if (/^\d{3}$/.test(digitsOnly)) {
    entry = CTY_BY_N3[digitsOnly];
  } else if (/^[A-Z]{2}$/.test(upper)) {
    entry = CTY_BY_A2[upper];
  } else if (/^[A-Z]{3}$/.test(upper)) {
    entry = CTY_BY_A3[upper];
  }

  if (entry) {
    return { alpha2: entry.a2, numeric: entry.n3 };
  }

  // Fallbacks for unknown/unsupported codes
  if (/^[A-Z]{2}$/.test(upper)) return { alpha2: upper, numeric: '' };
  if (/^\d{3}$/.test(digitsOnly)) return { alpha2: '', numeric: digitsOnly };

  return { alpha2: '', numeric: '' };
}

/**
 * Optional helper to get the full triplet (non-breaking add-on).
 */
export function normaliseCountryFull(code: CountryCode): { alpha2: string; alpha3: string; numeric: string } {
  const { alpha2, numeric } = normaliseCountry(code);
  const entry = alpha2 ? CTY_BY_A2[alpha2] : (numeric ? CTY_BY_N3[numeric] : undefined);
  return {
    alpha2: entry?.a2 ?? '',
    alpha3: entry?.a3 ?? '',
    numeric: entry?.n3 ?? '',
  };
}
