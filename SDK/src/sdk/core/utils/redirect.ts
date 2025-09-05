import type { Redirect } from '../../types/completion';

export function performRedirect(redirect: Redirect, formElement: HTMLFormElement | undefined) {
    const method = (redirect.method ?? 'GET').toUpperCase() as 'GET' | 'POST';
    const params = redirect.parameters ?? {};

    if (method === 'GET') {
        const redirectUrl = new URL(redirect.url, window.location.href);
        Object.entries(params).forEach(([key, value]) => redirectUrl.searchParams.set(key, value));

        window.location.assign(redirectUrl.toString());
    } else {
        let form = formElement;

        if (!form) {
            form = document.createElement('form');
        }

        if (redirect.url && form.action !== redirect.url) {
            form.method = 'POST';
            form.action = redirect.url;
        }

        Object.entries(params).forEach(([key, value]) => {
            attachHidden(form!, key, value);
        });

        document.body.appendChild(form);
        form.submit();
    }
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