import type { ParentToFrameMessage, FrameToParentMessage } from './messages';

export class FrameMessenger
{
  private readonly targetWindowProvider: () => (Window | null | undefined);
  private readonly targetOrigin: string;
  private readonly defaultTimeout: number;

  constructor(
    targetWindowProvider: () => Window | null | undefined,
    targetOrigin: string,
    defaultTimeout: number = 20_000
  )
  {
    this.targetWindowProvider = targetWindowProvider;
    this.targetOrigin = targetOrigin;
    this.defaultTimeout = defaultTimeout;
  }

  public post(message: ParentToFrameMessage): void
  {
    const targetWindow = this.targetWindowProvider();
    if (!targetWindow)
    {
      return;
    }
    targetWindow.postMessage(message, this.targetOrigin);
  }

  public waitFor<T>(
    match: (message: FrameToParentMessage) => boolean,
    map: (message: FrameToParentMessage) => T,
    timeoutMessage: string,
    timeoutMs: number = this.defaultTimeout
  ): Promise<T>
  {
    return new Promise<T>((resolve, reject) =>
    {
      const onMessage = (event: MessageEvent) =>
      {
        if (event.origin !== this.targetOrigin)
        {
          return;
        }

        const message = (event.data || {}) as FrameToParentMessage;

        if ((message as any)?.type === 'error')
        {
          cleanupListeners();
          const error = new Error((message as any).message || 'Operation failed');
          (error as any).code = (message as any).code ?? 'IFRAME_ERROR';
          reject(error);
          return;
        }

        if (match(message))
        {
          cleanupListeners();
          resolve(map(message));
        }
      };

      const timeoutId = setTimeout(() =>
      {
        cleanupListeners();
        reject(new Error(timeoutMessage));
      }, timeoutMs);

      const cleanupListeners = () =>
      {
        window.removeEventListener('message', onMessage);
        clearTimeout(timeoutId);
      };

      window.addEventListener('message', onMessage);
    });
  }
}
