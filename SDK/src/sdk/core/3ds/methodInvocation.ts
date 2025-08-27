export async function performThreeDSMethodInvocation(methodUrl?: string | null, methodData?: string | null, timeoutMs = 10000): Promise<'skipped' | 'performed' | 'timeout'> {
    if (!methodUrl || !methodData) {
        return 'skipped';
    }

    return new Promise((resolve) => {
        const iframe = document.createElement('iframe');
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        iframe.style.position = 'absolute';
        iframe.style.left = '-9999px';
        document.body.appendChild(iframe);

        const doc = iframe.contentWindow!.document;
        doc.open();
        doc.write(`
          <form id="threeDSMethodForm" action="${methodUrl}" method="POST">
            <input type="hidden" name="threeDSMethodData" value="${methodData}">
          </form>
          <script>document.getElementById('threeDSMethodForm').submit();</script>
        `);
        doc.close();

        const t = window.setTimeout(() => {
            cleanup();
            resolve('timeout');
        }, timeoutMs);

        // After timeout, assume method has had time to run (device info sent).
        function cleanup() {
            try { document.body.removeChild(iframe); } catch { }
            window.clearTimeout(t);
        }

        // Heuristic: give it half the timeout to run, then resolve 'performed' and clean up.
        window.setTimeout(() => { cleanup(); resolve('performed'); }, Math.min(6000, timeoutMs));
    });
}
