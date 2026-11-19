import { describe, expect, it } from 'vitest';
import { summarise, worstRoom } from './connection';
import type { AppRoomStatus, AppStatus } from './vibeparty/protocol';

const room = (over: Partial<AppRoomStatus> = {}): AppRoomStatus => ({ room: 'friday-vibes', peers: 1, queue: 0, playing: false, mode: 'live', ...over });
const status = (rooms: AppRoomStatus[] = [], over: Partial<AppStatus> = {}): AppStatus => ({
  hostRunning: true,
  idle: rooms.length === 0,
  online: true,
  rooms,
  ...over,
});

describe('connection summary', () => {
  it('says Live — and how many are watching — only when a room’s channel is up', () => {
    expect(summarise(status([room({ peers: 2 }), room({ room: 'b', peers: 3 })]), true)).toMatchObject({
      tone: 'success',
      label: 'Live · 5 watching',
      pulse: true,
    });
    expect(summarise(status([room({ peers: 0 })]), true).label).toBe('Live');
  });

  it('reports the room that needs attention most, never the best one', () => {
    const rooms = [room(), room({ room: 'b', mode: 'reconnecting' }), room({ room: 'c', mode: 'connecting' })];
    expect(worstRoom(rooms)?.room).toBe('b');
    expect(summarise(status(rooms), true)).toMatchObject({ tone: 'warning', label: 'Reconnecting…', retryable: true });
    expect(summarise(status([room(), room({ mode: 'error', reason: 'denied', message: 'The server refused this room.' })]), true)).toMatchObject({
      tone: 'destructive',
      label: 'Offline',
      hint: 'The server refused this room.',
      retryable: true,
    });
  });

  it('connecting is not live', () => {
    expect(summarise(status([room({ mode: 'connecting' })]), true)).toMatchObject({ label: 'Connecting…', tone: 'neutral', retryable: false });
  });

  it('a local room explains why it is local', () => {
    expect(summarise(status([room({ mode: 'local', reason: 'signed-out' })]), true)).toMatchObject({
      label: 'This browser only',
      hint: expect.stringMatching(/sign in/i),
    });
    expect(summarise(status([room({ mode: 'local', reason: 'unconfigured' })]), false).hint).toMatch(/no account service/i);
  });

  it('with no party running: Ready when live parties can work, otherwise why not', () => {
    expect(summarise(status(), true)).toMatchObject({ label: 'Ready', tone: 'neutral' });
    expect(summarise({ hostRunning: false, idle: true, online: false, rooms: [] }, true).label).toBe('Ready'); // no host yet: nothing to contradict the page
    expect(summarise(status([], { online: false, reason: 'signed-out' }), true)).toMatchObject({
      label: 'This browser only',
      hint: expect.stringMatching(/sign in/i),
    });
    expect(summarise(status(), false)).toMatchObject({ label: 'This browser only', hint: expect.stringMatching(/no account service/i) });
  });
});
