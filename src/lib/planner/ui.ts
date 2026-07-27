export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    if (char === '&') return '&amp;';
    if (char === '<') return '&lt;';
    if (char === '>') return '&gt;';
    if (char === '"') return '&quot;';
    return '&#39;';
  });
}

export function cssEsc(value: unknown): string {
  return String(value ?? '').replace(/["\\]/g, '\\$&');
}

export function highlightMatch(text: string, query: string): string {
  const safe = esc(text);
  if (!query) return safe;
  const idx = safe.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return safe;
  return safe.slice(0, idx) + '<mark>' + safe.slice(idx, idx + query.length) + '</mark>' + safe.slice(idx + query.length);
}

export function createToastController(element: HTMLElement, durationMs = 1800): (message: string) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return (message: string) => {
    element.textContent = message;
    element.classList.add('show');
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      element.classList.remove('show');
    }, durationMs);
  };
}

export function confirmDialog(
  title: string,
  message: string,
  confirmLabel: string,
  elements: {
    back: HTMLElement;
    title: HTMLElement;
    message: HTMLElement;
    ok: HTMLButtonElement;
    cancel: HTMLButtonElement;
  }
): Promise<boolean> {
  return new Promise((resolve) => {
    const { back, title: titleEl, message: messageEl, ok, cancel } = elements;

    titleEl.textContent = title;
    messageEl.textContent = message;
    ok.textContent = confirmLabel || 'Delete';
    back.classList.add('show');

    function cleanup(value: boolean) {
      back.classList.remove('show');
      ok.onclick = null;
      cancel.onclick = null;
      back.onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(value);
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') cleanup(false);
      else if (event.key === 'Enter') cleanup(true);
    }

    ok.onclick = () => cleanup(true);
    cancel.onclick = () => cleanup(false);
    back.onclick = (event) => {
      if (event.target === back) cleanup(false);
    };
    document.addEventListener('keydown', onKey);
    ok.focus();
  });
}

export function downloadJson(filename: string, data: unknown): void {
  const text = JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}