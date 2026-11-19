/**
 * The service worker's side of "Now playing": wires the hub (hub.ts) to the browser.
 *
 *   music tab ──report──▶ here ──▶ hub ──▶ storage.session (the new-tab page's widget)
 *                                      └──▶ publisher (offscreen page / Firefox background page) ──▶ the account, if shared
 *
 *   new-tab page ──storage.local (CONFIG_KEY)──▶ here: detect on/off, who may see it, paused
 *
 * Detect on = the content script is registered (scripts.ts) and the hub listens; off = it is unregistered and everything is
 * forgotten. All listeners are registered synchronously (a worker is woken by the events it listens for); the hub is built
 * once the saved state has been read, and every handler waits for it.
 */
import { browser } from 'wxt/browser';
import { NowPlayingHub, parseSaved } from './hub.ts';
import {
  ALARM,
  ALARM_PERIOD_MINUTES,
  CONFIG_KEY,
  CURRENT_KEY,
  type CurrentValue,
  isPublishResult,
  NO_CONFIG,
  type NowPlayingConfig,
  type PublishResult,
  parseConfig,
  parseContentReport,
  STATE_KEY,
} from './protocol.ts';
import { createScriptRegistrar, type ScriptRegistrar } from './scripts.ts';
import type { Track } from './track.ts';

/** How the worker reaches the publisher (a message to the offscreen page on Chromium, a direct call on Firefox). */
export type NowPlayingHost = {
  publish(track: Track): Promise<PublishResult>;
  clear(): Promise<void>;
};

const sessionArea = () => (browser.storage as { session?: typeof browser.storage.local }).session ?? browser.storage.local;

export function initNowPlayingBackground(host: NowPlayingHost, registrar: ScriptRegistrar = createScriptRegistrar()): { keepsHost(): boolean } {
  let hub: NowPlayingHub | null = null;
  let raw: NowPlayingConfig = NO_CONFIG;
  let alarmOn = false;

  const setAlarm = (on: boolean) => {
    if (on === alarmOn) return;
    alarmOn = on;
    if (!on) {
      void browser.alarms.clear(ALARM).catch(() => {});
      return;
    }
    // `create` with an existing name RESTARTS the alarm, and this is called on every report — so only create a missing one.
    void browser.alarms
      .get(ALARM)
      .then((existing) => (existing ? undefined : browser.alarms.create(ALARM, { periodInMinutes: ALARM_PERIOD_MINUTES })))
      .catch(() => {});
  };

  /** What the config means right now: asking to detect isn't enough, the browser must also have granted the player pages. */
  const apply = async (config: NowPlayingConfig) => {
    raw = config;
    const access = config.detect ? await registrar.hasAccess() : false;
    const effective = { ...config, detect: config.detect && access };
    hub?.setConfig(effective);
    try {
      if (effective.detect) await registrar.register();
      else await registrar.unregister();
    } catch {
      /* retried on the next start / change */
    }
  };

  const ready = (async () => {
    const area = sessionArea();
    const [saved, stored, alarm] = await Promise.all([
      area.get(STATE_KEY).catch(() => ({})),
      browser.storage.local.get(CONFIG_KEY).catch(() => ({})),
      browser.alarms.get(ALARM).catch(() => undefined),
    ]);
    alarmOn = alarm !== undefined;
    hub = new NowPlayingHub(
      {
        now: Date.now,
        publish: async (track) => {
          const result = await host.publish(track);
          return isPublishResult(result) ? result : 'error';
        },
        clear: () => host.clear(),
        emit: (now, at) => {
          const value: CurrentValue = { now, at };
          void area.set({ [CURRENT_KEY]: value }).catch(() => {});
        },
        setAlarm,
        shareRejected: () => {
          void browser.storage.local.set({ [CONFIG_KEY]: { ...raw, share: 'off' } }).catch(() => {});
        },
        save: (state) => void area.set({ [STATE_KEY]: state }).catch(() => {}),
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
      parseSaved((saved as Record<string, unknown>)[STATE_KEY]),
    );
    await apply(parseConfig((stored as Record<string, unknown>)[CONFIG_KEY]));
    return hub;
  })();
  void ready.catch(() => {});

  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    const report = parseContentReport(message);
    const tabId = sender.tab?.id;
    // Only our own content script, in a tab. (`sender.url` is the page's address as the BROWSER knows it — not what the page claims.)
    if (!report || sender.id !== browser.runtime.id || tabId === undefined) return;
    const url = sender.url ?? sender.tab?.url;
    void ready.then((h) => h?.report(tabId, url, report)).catch(() => {});
    return;
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void ready.then((h) => h?.tabClosed(tabId)).catch(() => {});
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void ready.then((h) => h?.tick()).catch(() => {});
  });

  browser.storage.onChanged.addListener((changes, area) => {
    const change = changes[CONFIG_KEY];
    if (area === 'local' && change) void ready.then(() => apply(parseConfig(change.newValue))).catch(() => {});
  });

  // The person can take the permission back at chrome://extensions at any time: stop reading, at once.
  const recheck = () => void ready.then(() => apply(raw)).catch(() => {});
  browser.permissions?.onRemoved?.addListener(recheck);
  browser.permissions?.onAdded?.addListener(recheck);

  return { keepsHost: () => hub?.holdsPublication ?? false };
}
