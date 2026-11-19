/**
 * The party host: the controller (what the tabs of this browser are doing) plus the Realtime transport (what the room is
 * doing), wired together — with no browser APIs in it, so the same code runs in an offscreen document (Chromium), in the
 * background page (Firefox) and in tests.
 *
 * Why a "host" at all? The Realtime connection needs the user's Supabase session, which lives in `localStorage` — and an
 * MV3 service worker has no `localStorage` and is torn down when idle. The long-lived extension page that can hold both is
 * the offscreen document (see host-page.ts); the service worker only forwards messages to it (background.ts).
 *
 * It persists the controller's state (tab → peer id, rooms) through `storage`, so if the host is ever recreated the tabs
 * keep their peer ids and re-announce themselves: a restart looks to the room like a brief reconnect of the same people.
 */
import { PartyController, type PersistedController } from './controller.ts';
import type { AppStatus, BackgroundToContent, HostCommand, OpenResult } from './protocol.ts';
import { type RealtimeLike, RealtimeTransport, type Timings } from './realtime-client.ts';

export type PartyHostDeps = {
  /** null = no Supabase project configured in this build. */
  client: RealtimeLike | null;
  /** Stable per-browser id: Presence key, and what lets a reconnecting browser reclaim its place. */
  clientId: string;
  uuid: () => string;
  /** Hand a message to a YouTube tab (the service worker does the actual `tabs.sendMessage`). */
  deliver: (tabId: number, msg: BackgroundToContent) => void;
  storage?: { load(): unknown; save(state: PersistedController): void };
  now?: () => number;
  random?: () => number;
  timings?: Partial<Timings>;
  /** How often silent tabs are pruned (ms). */
  pruneMs?: number;
  persistDebounceMs?: number;
};

export class PartyHost {
  readonly controller: PartyController;
  readonly transport: RealtimeTransport;
  private pruneTimer: ReturnType<typeof setInterval> | undefined;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: PartyHostDeps) {
    const now = deps.now ?? Date.now;
    // The transport and controller need each other: the controller is created second, through this ref.
    const ref: { controller?: PartyController } = {};
    this.transport = new RealtimeTransport(
      {
        client: deps.client,
        clientId: deps.clientId,
        getRoomState: (room) => ref.controller?.stateOf(room) ?? null,
        now,
        random: deps.random,
        timings: deps.timings,
      },
      {
        onStatus: (room, status) => ref.controller?.transportStatus(room, status),
        onMessage: (msg) => ref.controller?.transportMessage(msg),
        onLatency: (ms) => ref.controller?.setLatency(ms),
      },
    );
    this.controller = new PartyController({
      now,
      uuid: deps.uuid,
      send: deps.deliver,
      transport: this.transport,
      onChange: () => this.schedulePersist(),
    });
    ref.controller = this.controller;
  }

  /** Restore what the previous host knew, tell the room we are back, and start watching the session. */
  start(): void {
    try {
      this.controller.restore(this.deps.storage?.load());
    } catch {
      /* start clean */
    }
    this.controller.announceMembers();
    this.transport.start();
    this.pruneTimer = setInterval(() => this.controller.prune(), this.deps.pruneMs ?? 30_000);
  }

  stop(): void {
    clearInterval(this.pruneTimer);
    clearTimeout(this.persistTimer);
    this.persistNow();
    this.transport.stop();
  }

  /** One command from the service worker. Returns the response it should relay (for the ones that have one). */
  handle(cmd: HostCommand): AppStatus | OpenResult | { ok: true } | undefined {
    switch (cmd.type) {
      case 'vibeparty-host:content':
        this.controller.handleContent(cmd.tabId, cmd.message);
        return undefined;
      case 'vibeparty-host:tab-closed':
        this.controller.tabClosed(cmd.tabId);
        return undefined;
      case 'vibeparty-host:join-tab':
        this.controller.joinTab(cmd.tabId, cmd.room, cmd.name);
        return { ok: true };
      case 'vibeparty-host:expect-tab':
        this.controller.expectTab(cmd.tabId, cmd.room, cmd.name);
        return { ok: true };
      case 'vibeparty-host:status':
        return this.controller.appStatus();
      case 'vibeparty-host:retry':
        this.controller.retry();
        return { ok: true };
      case 'vibeparty-host:ping':
        return { ok: true };
      default:
        return undefined;
    }
  }

  private schedulePersist(): void {
    if (!this.deps.storage) return;
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.persistNow(), this.deps.persistDebounceMs ?? 250);
  }

  private persistNow(): void {
    try {
      this.deps.storage?.save(this.controller.serialize());
    } catch {
      /* storage full or unavailable: the party still works, it just won't survive a restart */
    }
  }
}
