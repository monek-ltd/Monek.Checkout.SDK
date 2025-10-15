import type { CompletionHelpers, Redirect } from "../../../types/completion";
import { performRedirect, attachHidden } from '../helpers/performRedirect';

export function buildCompletionHelpers(form: HTMLFormElement): CompletionHelpers
{
  const submitControls = form.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input[type=button], input[type=submit]');

  return {
    redirect: (input: Redirect | string) =>
    {
        const r: Redirect = (typeof input === 'string' ? { url: input } : input) as Redirect;
        
        const u = (r.url ?? '').toString().trim();

        if (!r.method) r.method = 'GET'
        performRedirect(r, form);
    },
    submitForm: (fields?: Record<string, string>) =>
    {
      if (fields)
      {
        Object.entries(fields).forEach(([key, value]) => attachHidden(form, key, value));
      }
      form.submit();
    },
    reenable: () => submitControls.forEach(control => control.disabled = false),
    disable: () => submitControls.forEach(control => control.disabled = true),
  };
}
