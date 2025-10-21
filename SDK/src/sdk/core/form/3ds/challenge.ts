import type { ChallengeOptions, ChallengeSize, ChallengeResult } from '../../../types/challenge-window';

const DEFAULT_HARD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export function openChallengeWindow(options: ChallengeOptions) {
  const {
    acsUrl,
    creq,
    display = 'popup',
    size = 'medium',
    onCancel,
    waitForResult,
  } = options;

  // ---- DOM: overlay + container ----
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'background:rgba(0,0,0,.5)',
    'z-index:999999',
    'display:flex',
    'align-items:center',
    'justify-content:center',
  ].join(';');

  const container = document.createElement('div');
  container.style.cssText = [
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

  container.appendChild(closeButton);
  container.appendChild(iframeElement);
  overlay.appendChild(container);
  document.body.appendChild(overlay);

  // ---- write a same-origin document, then POST to ACS with CReq ----
  const innerDocument = iframeElement.contentWindow!.document;
  innerDocument.open();
  innerDocument.write(`
    <!doctype html><meta charset="utf-8">
    <body>
      <form id="monek-3ds-form" action="${escapeHtml(acsUrl)}" method="POST">
        <input type="hidden" name="creq" value="${escapeHtml(creq)}">
      </form>
      <script>document.getElementById('monek-3ds-form').submit();</script>
    </body>
  `);
  innerDocument.close();

  // ---- completion ----
  let cleanedUp = false;

  function cleanup() {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;

    try {
      overlay.remove();
    } catch {
      // ignore
    }

    try {
      window.removeEventListener('keydown', onEscapeKey);
    } catch {
      // ignore
    }

    window.clearTimeout(hardTimeoutId);
  }

  function onEscapeKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      complete({ kind: 'closed' });
    }
  }
  window.addEventListener('keydown', onEscapeKey);

  const viaUserClosed = new Promise<ChallengeResult>((resolve) => {
    closeButton.addEventListener('click', () => {
      try { onCancel?.(); } catch { /* ignore */ }
      resolve({ kind: 'closed' });
    }, { once: true });
  });

  const viaResult = waitForResult
    ? (async () => {
        try {
          const data = await waitForResult();
          return { kind: 'polled', data } as const;
        } catch {
          await new Promise<never>(() => { /* keep pending */ });
          return undefined as never;
        }
      })()
    : new Promise<never>(() => {  });

  const hardTimeoutId = window.setTimeout(() => {
    complete({ kind: 'timeout' });
  }, DEFAULT_HARD_TIMEOUT_MS);

  function complete(result: ChallengeResult) {
    cleanup();
    resolveOnce(result);
  }

  let resolveOnce!: (r: ChallengeResult) => void;
  const done = new Promise<ChallengeResult>((resolve) => {
    resolveOnce = resolve;
  });

  Promise.race([viaResult, viaUserClosed]).then((result) => {
    // result can be undefined if viaResult was intentionally kept pending on error
    if (result) {
      complete(result);
    }
  });

  return {
    done,
    close: () => complete({ kind: 'closed' })
  };
}

// ---- helpers ----

export function getWindowSize(size: ChallengeSize): string {
  if (typeof size === 'string') {
    switch (size) {
      case 'small':  return '250px';
      case 'large':  return '600px';
      case 'medium':
      default:       return '500px';
    }
  } else {
    return `${Math.max(size.width, size.height)}px`;
  }
}

function sizeToCss(size: ChallengeSize): string {
  if (typeof size === 'string') {
    const pixels = getWindowSize(size);
    return `width:${pixels}; height:${pixels};`;
  }
  return `width:${size.width}px; height:${size.height}px;`;
}

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}
