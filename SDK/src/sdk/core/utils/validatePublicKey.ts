export const validatePublicKey = (publicKey: string): boolean =>
    /^(?:test|live)_[a-f0-9]{32}$/i.test(publicKey);
