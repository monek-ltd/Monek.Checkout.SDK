import { FRAMES } from '../../../config';
import type { ChallengeOptions, ChallengeSize, ChallengeResult } from '../../../types/challenge-window';
import type { Logger } from '../../utils/Logger';
import { performRedirect } from '../helpers/performRedirect';

const DEFAULT_HARD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
// The notification page auto-fires 3ds.challenge.close for every outcome. On the happy path the
// authoritative result arrives via the WebSocket back-channel (3ds.challenge.result, status Y);
// give it a brief grace window to win before the front-channel close completes the flow, so we
// don't proceed before the result is committed server-side.
const FRONT_CHANNEL_GRACE_MS = 1500;

export function openChallengeWindow(options: ChallengeOptions, logger: Logger) {
  const {
    acsUrl,
    creq,
    display = 'popup',
    size = 'medium',
    onCancel,
    waitForResult,
  } = options;

  // ---- DOM: overlay + container ----
  const overlayElement = document.createElement('div');
  overlayElement.style.cssText = [
    'position:fixed',
    'inset:0',
    'background:rgba(0,0,0,.5)',
    'z-index:999999',
    'display:flex',
    'align-items:center',
    'justify-content:center',
  ].join(';');

  const containerElement = document.createElement('div');
  containerElement.style.cssText = [
    'position:relative',
    'background:#fff',
    'border-radius:12px',
    'box-shadow:0 10px 35px rgba(0,0,0,.25)',
    'overflow:hidden',
    (display === 'fullscreen' ? 'width:100vw; height:100vh; border-radius:0;' : sizeToCss(size)),
  ].join(';');

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = '\u00D7';
  closeButton.setAttribute('aria-label', 'Close');
  closeButton.style.cssText = [
    'position:absolute',
    'top:8px',
    'right:12px',
    'border:0',
    'background:transparent',
    'font-size:28px',
    'line-height:1',
    'cursor:pointer',
    'z-index:2',
  ].join(';');

  const iframeElement = document.createElement('iframe');
  iframeElement.name = 'monek-3ds-frame';
  iframeElement.style.cssText = 'width:100%; height:100%; border:0; display:block;';

  containerElement.appendChild(closeButton);
  containerElement.appendChild(iframeElement);
  overlayElement.appendChild(containerElement);
  document.body.appendChild(overlayElement);

  // ---- Write a same-origin document, then POST to ACS with CReq ----
  const innerDocument = iframeElement.contentWindow!.document;
  const form = innerDocument.createElement('form');
  innerDocument.body.appendChild(form);

  performRedirect({
    url: acsUrl,
    method: 'POST',
    parameters: { creq }
  }, form, logger);

  // ---- Completion orchestration ----
  let isSettled = false;
  let isCleanedUp = false;

  let resolveDone!: (result: ChallengeResult) => void;
  const done = new Promise<ChallengeResult>((resolve) => { resolveDone = resolve; });

  let frontChannelCloseTimeoutId: number | undefined;

  const complete = (result: ChallengeResult) => {
    if (isSettled) {
      return;
    }
    isSettled = true;
    cleanup();
    resolveDone(result);
  };

  const cleanup = () => {
    if (isCleanedUp) {
      return;
    }
    isCleanedUp = true;

    try {
      window.removeEventListener('message', onWindowMessage);
    } catch { }
    try {
      window.removeEventListener('keydown', onEscapeKey);
    } catch { }
    try {
      overlayElement.remove();
    } catch { }

    window.clearTimeout(hardTimeoutId);
    if (frontChannelCloseTimeoutId !== undefined) {
      window.clearTimeout(frontChannelCloseTimeoutId);
    }
  };

  // User closed (button or ESC)
  const onEscapeKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      if (typeof onCancel === 'function') {
        try { onCancel(); } catch { }
      }
      complete({ kind: 'closed' });
    }
  };
  window.addEventListener('keydown', onEscapeKey);

  const viaUserClosed = new Promise<ChallengeResult>((resolve) => {
    closeButton.addEventListener('click', () => {
      if (typeof onCancel === 'function') {
        try { onCancel(); } catch { }
      }
      resolve({ kind: 'closed' });
    }, { once: true });
  });

  // Front-channel
  const onWindowMessage = (event: MessageEvent) => {
    if (event.source !== iframeElement.contentWindow) {
      return;
    }
    // The notification page is served from the frames host (the API 302-redirects the ACS return
    // there), so the front-channel 3ds.challenge.close message originates from FRAMES.base.
    if (event.origin !== new URL(FRAMES.base).origin) {
      return;
    }
    const data = event.data || {};
    if (data?.type === '3ds.challenge.close') {
      // Defer to the WebSocket back-channel result for a short grace period on the happy path.
      // complete() is idempotent, so if the back-channel resolves first this is a no-op; on
      // fail/cancel (no WS result) the flow proceeds after the grace period instead of hanging.
      if (frontChannelCloseTimeoutId === undefined) {
        frontChannelCloseTimeoutId = window.setTimeout(
          () => complete({ kind: 'polled', data }),
          FRONT_CHANNEL_GRACE_MS
        );
      }
    }
  };
  window.addEventListener('message', onWindowMessage);

  // Back-channel
  const viaBackChannel = waitForResult
    ? (async () => {
      try {
        const data = await waitForResult();
        return { kind: 'polled', data } as const;
      } catch {
        return new Promise<never>(() => undefined) as never;
      }
    })()
    : new Promise<never>(() => undefined);

  const hardTimeoutId = window.setTimeout(() => {
    complete({ kind: 'timeout' });
  }, DEFAULT_HARD_TIMEOUT_MS);

  Promise.race([viaUserClosed, viaBackChannel]).then((result) => {
    complete(result);
  });

  return {
    done,
    close: () => complete({ kind: 'closed' }),
  };
}

// ---- helpers ----

export function getWindowSize(size: ChallengeSize): string {
  if (typeof size === 'string') {
    switch (size) {
      case 'small': return '250px';
      case 'large': return '600px';
      case 'medium':
      default: return '500px';
    }
  } else {
    return `${Math.max(size.width, size.height)}px`;
  }
}

function sizeToCss(size: ChallengeSize): string {
  if (typeof size === 'string') {
    const pixelSize = getWindowSize(size);
    return `width:${pixelSize}; height:${pixelSize};`;
  }
  return `width:${size.width}px; height:${size.height}px;`;
}
