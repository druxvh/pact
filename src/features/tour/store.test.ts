import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOUR_KEY } from './store';

/** The store decides "first run?" while its module loads, so each case sets up storage and then imports it fresh. */
async function loadFresh() {
  vi.resetModules();
  return (await import('./store')).useTourStore;
}

beforeEach(() => {
  localStorage.clear();
});

describe('first run detection', () => {
  it('a brand-new install is offered the guest tour, and the answer is written down at once', async () => {
    const store = await loadFresh();
    expect(store.getState().completed).toEqual({ guest: false, full: false });
    expect(localStorage.getItem(TOUR_KEY)).not.toBeNull();
  });

  it('a reload on day one is still a newcomer (other keys appeared, but the tour record already existed)', async () => {
    await loadFresh();
    localStorage.setItem('pact-home', '{}'); // the app wrote its own state during the first visit
    const store = await loadFresh();
    expect(store.getState().completed.guest).toBe(false);
  });

  it('someone who used pact before the tour existed is a returning user: marked as having seen it', async () => {
    localStorage.setItem('pact-notes', '{"state":{},"version":3}');
    const store = await loadFresh();
    expect(store.getState().completed.guest).toBe(true);
    expect(store.getState().completed.full).toBe(false);
  });

  it('respects what is stored, and coerces junk', async () => {
    localStorage.setItem(TOUR_KEY, JSON.stringify({ state: { completed: { guest: true, full: 'yes' }, requested: 'x' }, version: 1 }));
    const store = await loadFresh();
    expect(store.getState().completed).toEqual({ guest: true, full: false });
    expect(store.getState().requested).toBe(false);
  });
});

describe('running the tour', () => {
  it('the welcome flow’s hand-off asks for the full tour, even for someone who saw it before', async () => {
    localStorage.setItem(TOUR_KEY, JSON.stringify({ state: { completed: { guest: false, full: true }, requested: false }, version: 1 }));
    const store = await loadFresh();
    store.getState().request();
    expect(store.getState()).toMatchObject({ requested: true, completed: { full: false } });
    expect(JSON.parse(localStorage.getItem(TOUR_KEY) ?? '{}').state.requested).toBe(true);
  });

  it('starting clears the request; finishing (or skipping) marks that kind as seen and closes it', async () => {
    const store = await loadFresh();
    store.getState().request();
    store.getState().start('full');
    expect(store.getState()).toMatchObject({ active: true, kind: 'full', index: 0, requested: false });
    store.getState().goTo(3);
    expect(store.getState().index).toBe(3);
    store.getState().finish();
    expect(store.getState()).toMatchObject({ active: false, index: 0, completed: { full: true } });
  });

  it('a replay works even though it was seen, and does not touch the other tour’s flag', async () => {
    const store = await loadFresh();
    store.getState().markSeen('full');
    store.getState().start('full');
    expect(store.getState().active).toBe(true);
    store.getState().finish();
    expect(store.getState().completed.guest).toBe(false);
  });

  it('the running tour is never persisted — a reload does not resume it', async () => {
    const store = await loadFresh();
    store.getState().start('guest');
    expect(JSON.parse(localStorage.getItem(TOUR_KEY) ?? '{}').state).not.toHaveProperty('active');
    const again = await loadFresh();
    expect(again.getState().active).toBe(false);
  });

  it('never goes to a negative step', async () => {
    const store = await loadFresh();
    store.getState().goTo(-4);
    expect(store.getState().index).toBe(0);
  });
});
