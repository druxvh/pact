import { browser } from 'wxt/browser';

const ALARM_PREFIX = 'pact-timer:';
const NOTIFICATION_PREFIX = 'pact-timer-';

type Phase = 'focus' | 'short' | 'long';

const COPY: Record<Phase, { title: string; message: string }> = {
  focus: { title: 'Focus session complete', message: 'Nice work. Time for a break.' },
  short: { title: 'Break is over', message: 'Ready for the next focus session?' },
  long: { title: 'Long break is over', message: 'Ready for the next focus session?' },
};

/** True when one of pact's own pages is the focused window (it will show its own toast + chime). */
async function pactIsFocused(): Promise<boolean> {
  try {
    const sw = self as unknown as { clients?: { matchAll: (o: object) => Promise<Array<{ focused?: boolean; url: string }>> } };
    const clients = await sw.clients?.matchAll({ type: 'window', includeUncontrolled: true });
    const base = browser.runtime.getURL('/newtab.html').replace(/newtab\.html$/, '');
    return Boolean(clients?.some((c) => c.focused && c.url.startsWith(base)));
  } catch {
    return false; // Firefox event pages have no `clients` — just notify
  }
}

/**
 * The timer UI schedules a `chrome.alarms` alarm for the moment a phase ends. This fires even if
 * every pact tab is closed (the whole point of using alarms), and shows a system notification —
 * unless pact is already focused, in which case the page itself announces it.
 */
export function registerTimerBackground(): void {
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (!alarm.name.startsWith(ALARM_PREFIX)) return;
    if (await pactIsFocused()) return;
    const phase = alarm.name.slice(ALARM_PREFIX.length) as Phase;
    const copy = COPY[phase] ?? COPY.focus;
    await browser.notifications.create(`${NOTIFICATION_PREFIX}${Date.now()}`, {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title: copy.title,
      message: copy.message,
      priority: 2,
    });
  });

  browser.notifications.onClicked.addListener(async (id) => {
    if (!id.startsWith(NOTIFICATION_PREFIX)) return;
    await browser.notifications.clear(id);
    const getUrl = browser.runtime.getURL.bind(browser.runtime) as (p: string) => string;
    await browser.tabs.create({ url: `${getUrl('/newtab.html')}#/timer` });
  });
}
