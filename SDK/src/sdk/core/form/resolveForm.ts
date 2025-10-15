export function resolveForm(container: Element | undefined, formOrSelector?: string | HTMLFormElement) {
  if (typeof formOrSelector === 'string') {
    return document.querySelector<HTMLFormElement>(formOrSelector);
  }
  if (formOrSelector instanceof HTMLFormElement) {
    return formOrSelector;
  }
  return container?.closest('form') as HTMLFormElement | null;
}
