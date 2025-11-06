export function normalisePhoneNumber(phone?: string): string | undefined {
    if (!phone) {
        return phone;
    }

    const digitsOnly = phone.replace(/\D+/g, '');

    if (!digitsOnly) {
        return undefined;
    }

    if (digitsOnly.startsWith('00')) {
        return digitsOnly.slice(2);
    }

    return digitsOnly;
}