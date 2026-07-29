import { CheckoutComponent } from './CheckoutComponent';
import { ExpressComponent } from './ExpressComponent';
import { fetchAccessKeyDetails, type AccessKeyDetails } from '../core/init/fetchAccessKey';
import { createSession } from '../core/init/createSession';

type PublicKey = string;

export type ComponentType = 'checkout' | 'express';
export type SessionProvider = () => Promise<string>;

export interface InitOptions {
  [key: string]: unknown;
}

export interface ComponentOptions extends InitOptions {
  applePayEnabled?: boolean;
  getSessionId?: SessionProvider;
}

function validatePublicKey(key: PublicKey): void {
  if (!key) throw new Error('Missing public key');
}

function buildComponentOptions(
  base: InitOptions,
  access: AccessKeyDetails,
  getSessionId: SessionProvider
): ComponentOptions {
  return {
    ...base,
    applePayEnabled: access.applePayEnabled,
    getSessionId,
  };
}

function createByType(
  type: ComponentType,
  publicKey: PublicKey,
  options: ComponentOptions
) {
  switch (type) {
    case 'checkout':
      return new CheckoutComponent(publicKey, options);
    case 'express':
      return new ExpressComponent(publicKey, options);
    default:
      throw new Error(`Unsupported component type: ${type}`);
  }
}

function createSessionManager(publicKey: PublicKey) {
  let pending: Promise<string> | null = null;

  const getSessionId: SessionProvider = () => {
    if (!pending) {
      // cache the PROMISE so concurrent checkout+express mounts share one POST /session
      pending = createSession(publicKey).catch((err) => {
        pending = null;
        throw err;
      });
    }
    return pending;
  };

  const resetSession = () => { 
    pending = null; 
  };

  return { getSessionId, resetSession };
}

export async function init(publicKey: PublicKey, options: InitOptions = {}) {
  validatePublicKey(publicKey);

  const defaultOptions: InitOptions = { ...options };
  const accessKeyDetails = await fetchAccessKeyDetails(publicKey);
  const session = createSessionManager(publicKey);

  return {
    createComponent(
      type: ComponentType,
      componentOptions: InitOptions = defaultOptions
    ) {
      const mergedOptions = buildComponentOptions(componentOptions, accessKeyDetails, session.getSessionId);
      return createByType(type, publicKey, mergedOptions);
    },
    getSessionId: session.getSessionId,
    resetSession: session.resetSession, // call on session-expired to force a fresh one
  };
}
