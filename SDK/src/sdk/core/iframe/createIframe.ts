export function buildFrameUrl(base: string, params: Record<string, string | undefined>) {
  const url = new URL(base);
  Object.entries(params).forEach(([k, v]) => { if (v) url.searchParams.set(k, v); });
  return url.toString();
}

export function createSandboxedIframe(src: string, height = '120px') {
  const iframe = document.createElement('iframe');
  iframe.src = src;
  iframe.style.width = '100%';
  iframe.style.height = height;
  iframe.style.border = '0';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  return iframe;
}
