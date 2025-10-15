import type { Redirect } from '../../../types/completion';

export function performRedirect(redirect: Redirect, formElement: HTMLFormElement | undefined) {
  const method = (redirect.method ?? 'GET').toUpperCase() as 'GET' | 'POST';
  const params = redirect.parameters ?? {};
  const rawUrl = redirect.url;

  if (!rawUrl || typeof rawUrl !== 'string') {
    console.error('performRedirect: missing redirect.url', redirect);
    // fail safe: stay put instead of going to /undefined
    return;
  }

  // Resolve relative against current page
  const resolvedUrl = new URL(rawUrl, window.location.href);

  if (method === 'GET') {
    Object.entries(params).forEach(([k, v]) => resolvedUrl.searchParams.set(k, String(v)));
    window.location.assign(resolvedUrl.toString());
    return;
  }

  // POST
  let form = formElement;
  if (!form) form = document.createElement('form');

  form.method = 'POST';

  // Always set absolute action
  form.action = resolvedUrl.toString();

  // Add/override params as hidden inputs
  Object.entries(params).forEach(([k, v]) => {
    attachHidden(form!, k, String(v));
  });

  if (!form.parentElement) document.body.appendChild(form);
  form.submit();
}

export function attachHidden(form: HTMLFormElement, name: string, value: string) {
  let input = form.querySelector<HTMLInputElement>(`input[name="${name.replace(/"/g, '\\"')}"]`);
  if (!input) {
    input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    form.appendChild(input);
  }
  input.value = String(value);
}
