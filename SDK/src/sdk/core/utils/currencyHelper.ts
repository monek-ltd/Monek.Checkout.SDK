import type { CurrencyCode, AmountInput, AmountNormalized } from '../../types/transaction-details';


const CURR_MAP_ALPHA_TO_NUM: Record<string, string> = {
    GBP: '826', USD: '840', EUR: '978', JPY: '392'
};
const CURR_MAP_NUM_TO_ALPHA: Record<string, string> = {
    '826': 'GBP', '840': 'USD', '978': 'EUR', '392': 'JPY'
};

export function normalizeCurrency(code: CurrencyCode): { alpha3: string; numeric: string } {
    const raw = String(code).trim().toUpperCase();
    if (/^\d+$/.test(raw)) {
        const alpha3 = CURR_MAP_NUM_TO_ALPHA[raw] ?? raw; 
        return { alpha3, numeric: raw };
    }
    const alpha3 = raw;
    const numeric = CURR_MAP_ALPHA_TO_NUM[alpha3] ?? '';
    return { alpha3, numeric };
}

export function currencyFractionDigits(alpha3: string): number {
    try {
        return new Intl.NumberFormat('en', { style: 'currency', currency: alpha3 })
            .resolvedOptions().maximumFractionDigits ?? 2;
    } catch {
        return 2;
    }
}

export function minorToMajorString(minor: number, alpha3: string): string {
    const d = currencyFractionDigits(alpha3);
    return (minor / Math.pow(10, d)).toFixed(d);
}

export function majorToMinor(major: string | number, alpha3: string): number {
    const d = currencyFractionDigits(alpha3);
    const n = typeof major === 'number' ? major : Number(String(major).replace(',', '.'));
    // avoid FP rounding issues
    return Math.round(n * Math.pow(10, d));
}

export function normalizeAmount(input: AmountInput): AmountNormalized {
    const { alpha3, numeric } = normalizeCurrency(input.currency);
    if ('minor' in input) {
        return {
            minor: input.minor ?? 0,
            major: minorToMajorString(input.minor ?? 0, alpha3),
            currencyAlpha3: alpha3,
            currencyNumeric: numeric || CURR_MAP_ALPHA_TO_NUM[alpha3] || ''
        };
    }
    const minor = majorToMinor(input.major, alpha3);
    return {
        minor,
        major: minorToMajorString(minor, alpha3),
        currencyAlpha3: alpha3,
        currencyNumeric: numeric || CURR_MAP_ALPHA_TO_NUM[alpha3] || ''
    };
}
