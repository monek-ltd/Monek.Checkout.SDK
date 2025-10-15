import type { CheckoutPort } from '../../../types/checkout-port';

export type TokenisedDetails = { cardTokenId: string; expiry: string };

export async function tokeniseAndGetExpiry(component: CheckoutPort): Promise<TokenisedDetails>
{
  const cardTokenId = await component.requestToken();
  const expiry = await component.requestExpiry();
  return { cardTokenId, expiry };
}
