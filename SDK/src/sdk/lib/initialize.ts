import { CheckoutComponent } from './CheckoutComponent';
import { ExpressComponent } from './ExpressComponent';
import { fetchAccessKeyDetails, type AccessKeyDetails } from '../core/init/fetchAccessKey';

type PublicKey = string;

export type ComponentType = 'checkout' | 'express';

export interface InitOptions {
  [key: string]: unknown;
}

export interface ComponentOptions extends InitOptions {
  applePayEnabled?: boolean;
}

function validatePublicKey(key: PublicKey): void {
  if (!key) throw new Error('Missing public key');
}

function buildComponentOptions(
  base: InitOptions,
  access: AccessKeyDetails
): ComponentOptions {
  return {
    ...base,
    applePayEnabled: access.applePayEnabled, 
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

export async function init(publicKey: PublicKey, options: InitOptions = {}) {
  validatePublicKey(publicKey);

  const defaultOptions: InitOptions = { ...options };

  const accessKeyDetails = await fetchAccessKeyDetails(publicKey);

  return {
    createComponent(
      type: ComponentType,
      componentOptions: InitOptions = defaultOptions
    ) {
      const mergedOptions = buildComponentOptions(componentOptions, accessKeyDetails);
      return createByType(type, publicKey, mergedOptions);
    },
  };
}
