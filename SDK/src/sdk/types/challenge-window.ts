export type ChallengeDisplay = 'fullscreen' | 'popup';
export type ChallengeSize =
  | 'small' | 'medium' | 'large'
  | { width: number; height: number };
  
export type ChallengeOptions = {
  acsUrl: string;
  creq: string;
  display?: ChallengeDisplay;
  size?: ChallengeSize;
  onCancel?: () => void;             // optional
  waitForResult?: () => Promise<any>;
  force?: boolean
};

export type ChallengePolledData = {
  status?: string;
  resultSummary?: string;
} & Record<string, unknown>;

export type ChallengeResult =
  | { kind: 'message'; data: any }
  | { kind: 'polled'; data: ChallengePolledData }
  | { kind: 'closed' }
  | { kind: 'timeout' };