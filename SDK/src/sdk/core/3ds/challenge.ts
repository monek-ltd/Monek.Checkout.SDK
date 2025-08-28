import type { ChallengeOptions, ChallengeSize, ChallengeResult } from '../../types/challenge-window';

export function challenge(options: ChallengeOptions){
    const {
        acsUrl, creq,
        display = 'popup',
        size = 'medium',
        onCancel,
        waitForResult
    } = options;
    
    // ---- DOM: overlay + container ----
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:999999;
        display:flex; align-items:center; justify-content:center;
      `;

    const container = document.createElement('div');
    container.style.cssText = `
        position:relative; background:#fff; border-radius:12px; box-shadow:0 10px 35px rgba(0,0,0,.25);
        overflow:hidden;
    ${display === 'fullscreen'
        ? 'width:100vw; height:100vh; border-radius:0;'
        : sizeToCss(size)}
    `;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent =  '\u00D7';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.style.cssText = `
        position:absolute; top:8px; right:12px; border:0; background:transparent;
        font-size:28px; line-height:1; cursor:pointer; z-index:2;
    `;

    closeBtn.addEventListener('click', () => {
        cleanup();
        onCancel?.();
        resolveOnce({ kind: 'closed' });
    });

    
    const frame = document.createElement('iframe');
    frame.name = 'monek-3ds-frame';
    frame.style.cssText = 'width:100%; height:100%; border:0; display:block;';

    container.appendChild(closeBtn);
    container.appendChild(frame);
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    // ---- write a same-origin document, then POST to ACS with CReq ----
    const doc = frame.contentWindow!.document;
    doc.open();
    doc.write(`
      <!doctype html><meta charset="utf-8">
        <body>
            <form id="f" action="${escapeHtml(acsUrl)}" method="POST">
                <input type="hidden" name="creq" value="${escapeHtml(creq)}">
            </form>
            <script>document.getElementById('f').submit();</script>
        </body>
    `);
    doc.close();
    
    // ---- completion: postMessage (front-channel) OR polling fallback ----
    let settled = false;
    let resolveOnce!: (r: ChallengeResult) => void;

    const done = new Promise<ChallengeResult>((resolve) => (resolveOnce = (r) => {
        if (settled) {
            return; settled = true;
        }
        resolve(r);
    }));

    let messageHandler: ((e: MessageEvent)=>void) | null = null;

    if(waitForResult) {
        waitForResult().then((data) => {
            cleanup();
            resolveOnce({ kind: 'polled', data });
        }).catch(() => {
        // ignore errors here; UI still open for user to finish/close
        });
    }

    // optional hard timeout (safety)
    const hardTimeout = window.setTimeout(() => {
        cleanup();
        resolveOnce({ kind: 'timeout' });
    }, 5 * 60 * 1000); // 5 min

    function cleanup() {
        try { 
            if (messageHandler) {
                window.removeEventListener('message', messageHandler); 
            }
        } catch {}
                
        try { 
            overlay.remove(); 
        } catch {}

        window.clearTimeout(hardTimeout);
    }

  return { done, close: cleanup };
}

export function getWindowSize(size: ChallengeSize): string { 
    if (typeof size === 'string') {
        switch (size) {
            case 'small':  return '250px';
            case 'large':  return '600px';
            case 'medium':
            default:       return '500px';
        }
    }
    else {
        return `${Math.max(size.width, size.height)}px`;
    }
}

function sizeToCss(size: ChallengeSize): string {
  if (typeof size === 'string') {
      let pixals = getWindowSize(size);
      return `width:${pixals}; height:${pixals};`;
    }
    return `width:${size.width}px; height:${size.height}px;`;
}

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}