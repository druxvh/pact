import { notify } from '@/lib/toast';

/** Copy text to the clipboard (with a legacy fallback) and confirm with a toast. */
export async function copyText(text: string, label = 'Copied to clipboard'): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (!ok) throw new Error('copy failed');
    } catch {
      notify.error("Couldn't copy", 'Your browser blocked clipboard access.');
      return false;
    }
  }
  if (label) notify.success(label);
  return true;
}
