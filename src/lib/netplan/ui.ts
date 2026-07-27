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

export async function copyTextWithFallback(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
      return true;
    } catch {
      return false;
    }
  }
}

export function downloadTextFile(filename: string, text: string, mimeType = 'text/plain'): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}