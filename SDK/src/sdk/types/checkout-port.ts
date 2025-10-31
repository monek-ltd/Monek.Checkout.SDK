import type { CompletionOptions } from './completion';
import type { InitCallbacks } from './callbacks';
import type { ChallengeOptions } from './challenge-window';
import type { SettlementType, CardEntry, Intent, Order } from './transaction-details';

export interface CheckoutPort
{
  // --- Completion / callbacks ---
  getCompletionOptions(): CompletionOptions | undefined;
  getCallbacks(): InitCallbacks;

  // --- Session / identity ---
  getSessionId(): string;
  getPublicKey(): string;

  // --- Iframe RPC ---
  requestToken(): Promise<string>;
  requestExpiry(): Promise<string>;

  // --- 3DS / UX options ---
  getChallengeOptions(): ChallengeOptions;

  // --- Payment config ---
  getSettlementType(): SettlementType;
  getCardEntry(): CardEntry;
  getIntent(): Intent;
  getOrder(): Order;
  getCountryCode(): { alpha2: string; alpha3: string; numeric: string };
  getStoreCardDetails(): boolean;

  // --- Optional metadata ---
  getValidityId(): string | undefined;
  getChannel(): string;
  getPaymentReference(): string;

  // --- Environment info ---
  getSourceIp(): Promise<string | undefined>;
}
