/**
 * Styling types + helpers for Hosted Fields + Challenge UI.
 *
 * - Layout/spacing: containerPadding, textAlign, buttonAlign
 * - Core styles: backgroundColor, textColor, fontFamily, borderRadius
 * - Inputs: inputBackgroundColor, inputTextColor, inputBorderColor, inputBorderRadius
 * - Typography: fontSize
 * - Presets: 'light' | 'dark'
 *
 * Usage in parent:
 *   const normalised = normaliseStyling({ theme:'dark', core:{ borderRadius: 10 } });
 *   const vars = toCssVars(normalised);
 *   iframe.contentWindow!.postMessage({ type:'configure', themeVars: vars }, targetOrigin);
 *
 * In iframe CSS, consume variables like:
 *   background: var(--monek-bg);
 *   color: var(--monek-text);
 *   font-family: var(--monek-font-family);
 *   font-size: var(--monek-font-size);
 */

////////////////////
// Raw option types
////////////////////

export type ThemeName = 'light' | 'dark';

export type TextAlign = 'left' | 'center' | 'right';
export type ButtonAlign = 'left' | 'center' | 'right' | 'stretch';

export type CSSLength = string | number;

export interface LayoutOptions {
    containerPadding?: CSSLength | [CSSLength, CSSLength] | [CSSLength, CSSLength, CSSLength, CSSLength];
    textAlign?: TextAlign;
    buttonAlign?: ButtonAlign;
}

export interface CoreStyles {
    backgroundColor?: string;
    textColor?: string;
    fontFamily?: string;
    borderRadius?: CSSLength;
}

export interface InputStyles {
    inputBackgroundColor?: string;
    inputTextColor?: string;
    inputBorderColor?: string;
    inputBorderRadius?: CSSLength;
}

export interface TypographyOptions {
    fontSize?: CSSLength;
}

export interface StylingOptions {

    /** Optional preset theme to start from, then overridden by other options. */
    theme?: ThemeName;

    layout?: LayoutOptions;
    core?: CoreStyles;
    inputs?: InputStyles;
    typography?: TypographyOptions;

    /** Power user: raw CSS variables to merge/override. (keys must include leading --) */
    cssVars?: Record<string, string>;
}

////////////////////////
// Normalised types
////////////////////////

export interface normalisedLayout {
    containerPadding: string;
    textAlign: TextAlign;
    buttonAlign: ButtonAlign;
}

export interface normalisedCore {
    backgroundColor: string;
    textColor: string;
    fontFamily: string;
    borderRadius: string;
}

export interface normalisedInputs {
    inputBackgroundColor: string;
    inputTextColor: string;
    inputBorderColor: string;
    inputBorderRadius: string;
}

export interface normalisedTypography {
    fontSize: string;
}

export interface normalisedStyling {
    baseTheme: ThemeName;
    layout: normalisedLayout;
    core: normalisedCore;
    inputs: normalisedInputs;
    typography: normalisedTypography;
    cssVars: Record<string, string>; // any extra/overrides
}

////////////////////////
// Preset themes
////////////////////////

const PRESETS: Record<ThemeName, normalisedStyling> = {
    light: {
        baseTheme: 'light',
        layout: {
            containerPadding: '12px',
            textAlign: 'left',
            buttonAlign: 'stretch',
        },
        core: {
            backgroundColor: '#ffffff',
            textColor: '#111827', 
            fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
            borderRadius: '8px',
        },
        inputs: {
            inputBackgroundColor: '#ffffff',
            inputTextColor: '#111827',
            inputBorderColor: '#d1d5db',
            inputBorderRadius: '8px',
        },
        typography: {
            fontSize: '14px',
        },
        cssVars: {},
    },
    dark: {
        baseTheme: 'dark',
        layout: {
            containerPadding: '12px',
            textAlign: 'left',
            buttonAlign: 'stretch',
        },
        core: {
            backgroundColor: '#0b0f14',
            textColor: '#e5e7eb',
            fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
            borderRadius: '8px',
        },
        inputs: {
            inputBackgroundColor: '#111827', 
            inputTextColor: '#e5e7eb',
            inputBorderColor: '#374151',
            inputBorderRadius: '8px',
        },
        typography: {
            fontSize: '14px',
        },
        cssVars: {},
    },
};

////////////////////////
// Validators & coercers
////////////////////////

const LEN_RX = /^-?\d*\.?\d+(px|rem|em|vh|vw|%)$/i;
const HEX_RX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function coerceLength(value: CSSLength | undefined, fallback: string): string {
    if (value == null) {
        return fallback;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return `${value}px`;
    }
    const string = String(value).trim();
    if (string === '') {
        return fallback;
    }
    if (LEN_RX.test(string)) {
        return string;
    }

    // if value is numeric string, add px
    const number = Number(string);
    if (!Number.isNaN(number)) {
        return `${number}px`;
    }

    return string;
}

function coercePadding(
    padding: LayoutOptions['containerPadding'],
    fallback: string
): string {
    if (padding == null) {
        return fallback;
    }
    if (Array.isArray(padding)) {
        if (padding.length === 2) {
            const [y, x] = padding;
            return `${coerceLength(y, '0px')} ${coerceLength(x, '0px')}`;
        }
        if (padding.length === 4) {
            const [t, r, b, l] = padding;
            return [
                coerceLength(t, '0px'),
                coerceLength(r, '0px'),
                coerceLength(b, '0px'),
                coerceLength(l, '0px'),
            ].join(' ');
        }
        return fallback;
    }
    return coerceLength(padding, fallback);
}

function coerceColor(value: string | undefined, fallback: string): string {
    if (value == null || value.trim() === '') {
        return fallback;
    }
    const string = value.trim();

    if (string.startsWith('var(')) {
        return string;
    }
    if (string.startsWith('rgb') || string.startsWith('hsl')) {
        return string;
    }
    if (HEX_RX.test(string)) {
        return string;
    }

    return string;
}

function coerceAlign<T extends string>(val: T | undefined, allowed: readonly T[], fallback: T): T {
    return (val && (allowed as readonly string[]).includes(val as unknown as string))
        ? val
        : fallback;
}

function coerceString(value: string | undefined, fallback: string): string {
    const string = (value ?? '').trim();
    return string === '' ? fallback : string;
}

////////////////////////
// Normalization
////////////////////////

export function normaliseStyling(opts?: StylingOptions): normalisedStyling {
    const presetName: ThemeName = (opts?.theme ?? 'light');
    const preset = PRESETS[presetName];

    const layout: normalisedLayout = {
        containerPadding: coercePadding(opts?.layout?.containerPadding, preset.layout.containerPadding),
        textAlign: coerceAlign<TextAlign>(opts?.layout?.textAlign, ['left', 'center', 'right'] as const, preset.layout.textAlign),
        buttonAlign: coerceAlign<ButtonAlign>(opts?.layout?.buttonAlign, ['left', 'center', 'right', 'stretch'] as const, preset.layout.buttonAlign),
    };

    const core: normalisedCore = {
        backgroundColor: coerceColor(opts?.core?.backgroundColor, preset.core.backgroundColor),
        textColor: coerceColor(opts?.core?.textColor, preset.core.textColor),
        fontFamily: coerceString(opts?.core?.fontFamily, preset.core.fontFamily),
        borderRadius: coerceLength(opts?.core?.borderRadius, preset.core.borderRadius),
    };

    const inputs: normalisedInputs = {
        inputBackgroundColor: coerceColor(opts?.inputs?.inputBackgroundColor, preset.inputs.inputBackgroundColor),
        inputTextColor: coerceColor(opts?.inputs?.inputTextColor, preset.inputs.inputTextColor),
        inputBorderColor: coerceColor(opts?.inputs?.inputBorderColor, preset.inputs.inputBorderColor),
        inputBorderRadius: coerceLength(opts?.inputs?.inputBorderRadius, preset.inputs.inputBorderRadius),
    };

    const typography: normalisedTypography = {
        fontSize: coerceLength(opts?.typography?.fontSize, preset.typography.fontSize),
    };

    // Merge extra cssVars (power-user) — later keys win
    const cssVars = { ...preset.cssVars, ...(opts?.cssVars ?? {}) };

    return { baseTheme: presetName, layout, core, inputs, typography, cssVars };
}

////////////////////////
// CSS variable mapping
////////////////////////

/**
 * Convert normalisedStyling to a map of CSS variables that the iframe consumes.
 * (These names must match the CSS your iframe uses.)
 */
export function toCssVars(n: normalisedStyling): Record<string, string> {
    const vars: Record<string, string> = {
        // Layout
        '--monek-container-padding': n.layout.containerPadding,
        '--monek-text-align': n.layout.textAlign,
        '--monek-button-align': n.layout.buttonAlign,

        // Core
        '--monek-bg': n.core.backgroundColor,
        '--monek-text': n.core.textColor,
        '--monek-font-family': n.core.fontFamily,
        '--monek-radius': n.core.borderRadius,

        // Inputs
        '--monek-input-bg': n.inputs.inputBackgroundColor,
        '--monek-input-text': n.inputs.inputTextColor,
        '--monek-input-border': n.inputs.inputBorderColor,
        '--monek-input-radius': n.inputs.inputBorderRadius,

        // Typography
        '--monek-font-size': n.typography.fontSize,

        // Theme flag 
        '--monek-theme': n.baseTheme,
    };

    Object.entries(n.cssVars).forEach(([k, v]) => {
        if (k.startsWith('--')) vars[k] = v;
    });

    return vars;
}

////////////////////////
// Convenience helpers
////////////////////////

export function getPreset(name: ThemeName = 'light'): normalisedStyling {
    return PRESETS[name];
}

export function buildThemeVars(opts?: StylingOptions): Record<string, string> {
    return toCssVars(normaliseStyling(opts));
}
