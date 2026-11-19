import { MotionGlobalConfig } from 'motion/react';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

/** Lets React flush effects inside `act()` — vitest has no React test renderer, so the few component tests here use this. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
/** happy-dom's Web Animations reject when motion cancels them on unmount; finish animations instantly instead. */
MotionGlobalConfig.skipAnimations = true;

export type Mounted = { container: HTMLElement; unmount: () => Promise<void> };

/** Render `element` into the document and let its effects run. */
export async function mount(element: ReactElement): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

/** Run `fn` (an event dispatch, a timer advance…) and flush React. */
export async function run(fn: () => void | Promise<void>): Promise<void> {
  await act(async () => {
    await fn();
  });
}

export const press = (el: Element, key: string, init: KeyboardEventInit = {}) =>
  run(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });

/** Type into a controlled <input>/<textarea> the way a browser would, so React's onChange fires. */
export const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) =>
  run(() => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

export const click = (el: Element) =>
  run(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
