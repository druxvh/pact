import { describe, expect, it } from 'vitest';
import { describeError, isMissingColumn, toActivityEvent, toBan, toChannel, toCommunityError, toMember, toProfile } from './mapping';
import { can, canActOnMember, canUnban } from './permissions';
import {
  formatUntil,
  formatWait,
  SLOWMODE_OPTIONS,
  slowmodeLabel,
  slowmodeRemainingMs,
  slowmodeShort,
  TIMEOUT_MAX_SECONDS,
  TIMEOUT_OPTIONS,
  timeoutActive,
} from './safety';
import { CommunityError } from './types';

describe('slowmode and timeout choices', () => {
  it('offers Off, 5s, 10s, 30s, 1m, 5m, 15m, 1h and 6h — all within what the server accepts', () => {
    expect(SLOWMODE_OPTIONS.map(slowmodeLabel)).toEqual([
      'Off',
      '5 seconds',
      '10 seconds',
      '30 seconds',
      '1 minute',
      '5 minutes',
      '15 minutes',
      '1 hour',
      '6 hours',
    ]);
    expect(SLOWMODE_OPTIONS.map(slowmodeShort)).toEqual(['0s', '5s', '10s', '30s', '1m', '5m', '15m', '1h', '6h']);
    expect(Math.max(...SLOWMODE_OPTIONS)).toBe(21600);
  });
  it('timeouts: 60s, 5m, 1h, 1d, 1w (max 28 days)', () => {
    expect(TIMEOUT_OPTIONS.map((o) => o.seconds)).toEqual([60, 300, 3600, 86400, 604800]);
    expect(Math.max(...TIMEOUT_OPTIONS.map((o) => o.seconds))).toBeLessThanOrEqual(TIMEOUT_MAX_SECONDS);
    expect(TIMEOUT_MAX_SECONDS).toBe(28 * 86400);
  });
  it('waits read as countdowns and round up', () => {
    expect(formatWait(0)).toBe('0s');
    expect(formatWait(0.2)).toBe('1s');
    expect(formatWait(59)).toBe('59s');
    expect(formatWait(65)).toBe('1m 05s');
    expect(formatWait(3600)).toBe('1h 00m');
    expect(formatWait(7380)).toBe('2h 03m');
    expect(formatWait(-5)).toBe('0s');
  });
});

describe('timeouts in force', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');
  it('active only while the end time is in the future', () => {
    expect(timeoutActive('2026-11-18T12:00:01Z', now)).toBe(true);
    expect(timeoutActive('2026-11-18T12:00:00Z', now)).toBe(false);
    expect(timeoutActive('2026-11-17T12:00:00Z', now)).toBe(false);
    expect(timeoutActive(null, now)).toBe(false);
    expect(timeoutActive(undefined, now)).toBe(false);
    expect(timeoutActive('not a date', now)).toBe(false);
  });
  it('the end time is a clock time today and a date + time on another day', () => {
    const today = formatUntil('2026-11-18T23:30:00', now);
    const later = formatUntil('2026-11-20T23:30:00', now);
    expect(today).not.toMatch(/Nov/);
    expect(later).toMatch(/Nov/);
    expect(formatUntil('nonsense', now)).toBe('later');
  });
});

describe('how long until I can post again (slowmode)', () => {
  const base = { slowmodeSeconds: 30, exempt: false, now: 1_000_000 };
  it('off, or exempt (moderators and the admin): never any wait', () => {
    expect(slowmodeRemainingMs({ ...base, slowmodeSeconds: 0, lastOwnAt: new Date(base.now).toISOString(), cooldownUntil: base.now + 5000 })).toBe(0);
    expect(slowmodeRemainingMs({ ...base, exempt: true, lastOwnAt: new Date(base.now).toISOString(), cooldownUntil: base.now + 5000 })).toBe(0);
  });
  it('after a reload, counts from my last message in the history', () => {
    expect(slowmodeRemainingMs({ ...base, lastOwnAt: new Date(base.now - 10_000).toISOString(), cooldownUntil: undefined })).toBe(20_000);
    expect(slowmodeRemainingMs({ ...base, lastOwnAt: new Date(base.now - 31_000).toISOString(), cooldownUntil: undefined })).toBe(0);
    expect(slowmodeRemainingMs({ ...base, lastOwnAt: null, cooldownUntil: undefined })).toBe(0);
  });
  it('a cooldown measured on this computer is the whole answer (history can’t extend it)', () => {
    expect(slowmodeRemainingMs({ ...base, lastOwnAt: new Date(base.now - 1000).toISOString(), cooldownUntil: base.now + 4000 })).toBe(4000);
    expect(slowmodeRemainingMs({ ...base, lastOwnAt: new Date(base.now - 1000).toISOString(), cooldownUntil: base.now - 1 })).toBe(0);
  });
  it('never longer than the slowmode itself, and a clock that is behind the server’s doesn’t lock you out', () => {
    expect(slowmodeRemainingMs({ ...base, lastOwnAt: null, cooldownUntil: base.now + 999_000 })).toBe(30_000);
    // my last message is stamped "in the future" by 10 minutes: this computer's clock is behind — let the server decide
    expect(slowmodeRemainingMs({ ...base, lastOwnAt: new Date(base.now + 600_000).toISOString(), cooldownUntil: undefined })).toBe(0);
    // a few seconds of skew is just noise
    expect(slowmodeRemainingMs({ ...base, lastOwnAt: new Date(base.now + 2000).toISOString(), cooldownUntil: undefined })).toBe(30_000);
  });
});

describe('server errors and rows', () => {
  it('slowmode:<seconds> and timed_out:<iso> carry what the person needs', () => {
    const s = toCommunityError({ code: 'P0001', message: 'slowmode:12' });
    expect([s.code, s.detail]).toEqual(['slowmode', { seconds: 12 }]);
    expect(describeError(s)).toBe('Slowmode is on in this channel — you can send again in 12s.');
    const t = toCommunityError({ code: 'P0001', message: 'timed_out:2026-11-18T12:00:00.000Z' });
    expect([t.code, t.detail]).toEqual(['timed_out', { until: '2026-11-18T12:00:00.000Z' }]);
    expect(describeError(t)).toContain('You’re timed out until');
    expect(describeError(t)).toContain('read, but not post or react');
  });
  it('malformed details don’t crash the mapping', () => {
    expect(toCommunityError({ message: 'slowmode:soon' })).toMatchObject({ code: 'slowmode', detail: undefined });
    expect(toCommunityError({ message: 'timed_out:whenever' })).toMatchObject({ code: 'timed_out', detail: undefined });
    expect(describeError(new CommunityError('slowmode'))).toContain('Slowmode');
    expect(describeError(new CommunityError('timed_out'))).toContain('timed out');
  });
  it('the other new codes read as sentences', () => {
    expect(toCommunityError({ message: 'bad_duration' }).code).toBe('bad_duration');
    expect(describeError(new CommunityError('bad_duration'))).toContain('28 days');
    expect(toCommunityError({ message: 'not_a_member' }).code).toBe('not_a_member');
    expect(describeError(new CommunityError('not_a_member'))).toContain('isn’t in this community');
    expect(describeError(new CommunityError('banned', 'That person is banned from this community.'))).toBe('That person is banned from this community.');
    expect(describeError(new CommunityError('banned'))).toBe('You can’t join this community.');
  });
  it('a channel row: slowmode defaults to 0 (an older database has no such column) and is never negative', () => {
    expect(toChannel({ id: 'c', community_id: 'k', name: 'general', topic: '' }).slowmodeSeconds).toBe(0);
    expect(toChannel({ id: 'c', community_id: 'k', name: 'general', topic: '', slowmode_seconds: 30 }).slowmodeSeconds).toBe(30);
    expect(toChannel({ id: 'c', community_id: 'k', name: 'general', topic: '', slowmode_seconds: -4 }).slowmodeSeconds).toBe(0);
  });
  it('a member row: timeout when there is one, a safe role otherwise', () => {
    expect(toMember({ user_id: 'u', role: 'mod', joined_at: 'j', timeout_until: '2026-11-18T12:00:00Z' })).toEqual({
      userId: 'u',
      role: 'mod',
      joinedAt: 'j',
      timeoutUntil: '2026-11-18T12:00:00Z',
    });
    expect(toMember({ user_id: 'u', role: 'overlord', joined_at: 'j' })).toMatchObject({ role: 'member', timeoutUntil: null });
  });
  it('a ban row', () => {
    expect(toBan({ user_id: 'u', banned_by: 'm', reason: 'spam', created_at: 't' })).toEqual({ userId: 'u', bannedBy: 'm', reason: 'spam', createdAt: 't' });
    expect(toBan({ user_id: 'u' })).toEqual({ userId: 'u', bannedBy: null, reason: '', createdAt: '' });
  });
  it('avatars: the stored path goes through the resolver; no column, no path or no resolver means no avatar', () => {
    const resolve = (p: string) => `https://cdn.test/avatars/${p}`;
    const row = { id: 'u', username: 'ann', display_name: 'Ann', designation: '' };
    expect(toProfile({ ...row, avatar_path: 'u/a.webp' }, resolve).avatarUrl).toBe('https://cdn.test/avatars/u/a.webp');
    expect('avatarUrl' in toProfile({ ...row, avatar_path: null }, resolve)).toBe(false);
    expect('avatarUrl' in toProfile({ ...row, avatar_path: '' }, resolve)).toBe(false);
    expect('avatarUrl' in toProfile(row, resolve)).toBe(false); // the migration isn't applied yet
    expect('avatarUrl' in toProfile({ ...row, avatar_path: 'u/a.webp' })).toBe(false);
    expect(toProfile({ ...row, avatar_path: 'u/a.webp' }, () => undefined).avatarUrl).toBeUndefined();
  });
  it('profiles: bio and links reach the card, links are validated (they are somebody else’s input), and missing columns are fine', () => {
    const row = { id: 'u', username: 'ann', display_name: 'Ann', designation: 'Designer' };
    const links = [
      { kind: 'instagram', url: 'https://instagram.com/ann' },
      { kind: 'github', url: 'javascript:alert(1)' }, // not https
      { kind: 'github', url: 'https://github.com.evil.example/ann' }, // wrong host
      { kind: 'nonsense', url: 'https://ann.dev/' }, // unknown platform
      { kind: 'website', url: 'http://ann.dev/' }, // http is upgraded to https
      { kind: 'instagram', url: 'https://instagram.com/ann' }, // duplicate
    ];
    const p = toProfile({ ...row, bio: '  Makes things.  ', links });
    expect(p.bio).toBe('Makes things.');
    expect(p.links).toEqual([
      { kind: 'instagram', url: 'https://instagram.com/ann' },
      { kind: 'website', url: 'https://ann.dev/' },
    ]);
    expect(toProfile({ ...row, links: Array.from({ length: 9 }, (_, i) => ({ kind: 'website', url: `https://a${i}.dev/` })) }).links).toHaveLength(5);
    // no column (migration not applied), null, junk, or empty: no key at all
    for (const bad of [undefined, null, 'x', 7, {}, []]) expect('links' in toProfile({ ...row, links: bad })).toBe(false);
    expect('bio' in toProfile(row)).toBe(false);
    expect('bio' in toProfile({ ...row, bio: '   ' })).toBe(false);
    expect('bio' in toProfile({ ...row, bio: 42 })).toBe(false);
  });
  it('a realtime message insert becomes an activity event (or nothing, if it is unusable)', () => {
    const row = {
      id: 'm',
      channel_id: 'ch',
      community_id: 'co',
      author_id: 'u',
      created_at: 't',
      body: 'hi @ann',
      reply_to: 'r',
      attachments: [{ path: 'co/u/a.png' }],
    };
    expect(toActivityEvent(row)).toEqual({
      messageId: 'm',
      channelId: 'ch',
      communityId: 'co',
      authorId: 'u',
      createdAt: 't',
      body: 'hi @ann',
      replyTo: 'r',
      hasAttachments: true,
    });
    expect(toActivityEvent({ ...row, reply_to: null, attachments: [] })).toMatchObject({ replyTo: null, hasAttachments: false });
    expect(toActivityEvent({ ...row, id: undefined })).toBeNull();
    expect(toActivityEvent({})).toBeNull();
  });
  it('recognises a database that is missing a column', () => {
    expect(isMissingColumn({ code: '42703', message: 'x' })).toBe(true);
    expect(isMissingColumn({ code: 'PGRST204', message: "Could not find the 'avatar_path' column of 'profiles' in the schema cache" })).toBe(true);
    expect(isMissingColumn({ message: 'column profiles.avatar_path does not exist' })).toBe(true);
    expect(isMissingColumn({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingColumn(null)).toBe(false);
  });
});

describe('who may do what (mirrors the database)', () => {
  it('slowmode, the ban list and bypassing slowmode: moderators and the admin', () => {
    for (const a of ['setSlowmode', 'viewBans', 'bypassSlowmode'] as const) {
      expect([can('member', a), can('mod', a), can('admin', a), can(null, a)]).toEqual([false, true, true, false]);
    }
    expect([can('member', 'transferAdmin'), can('mod', 'transferAdmin'), can('admin', 'transferAdmin')]).toEqual([false, false, true]);
  });
  it('timeouts: the admin → mods and members; a moderator → members; nobody → the admin', () => {
    expect(canActOnMember('admin', 'mod', 'timeout')).toBe(true);
    expect(canActOnMember('admin', 'member', 'timeout')).toBe(true);
    expect(canActOnMember('mod', 'member', 'timeout')).toBe(true);
    expect(canActOnMember('mod', 'mod', 'timeout')).toBe(false);
    expect(canActOnMember('member', 'member', 'timeout')).toBe(false);
    for (const actor of ['admin', 'mod', 'member'] as const) expect(canActOnMember(actor, 'admin', 'timeout')).toBe(false);
  });
  it('making someone admin: only the admin, to a moderator or member', () => {
    expect(canActOnMember('admin', 'member', 'transferAdmin')).toBe(true);
    expect(canActOnMember('admin', 'mod', 'transferAdmin')).toBe(true);
    expect(canActOnMember('admin', 'admin', 'transferAdmin')).toBe(false);
    expect(canActOnMember('mod', 'member', 'transferAdmin')).toBe(false);
  });
  it('lifting a ban: the admin any, a moderator only their own, nobody their own', () => {
    expect(canUnban('admin', { bannedBy: 'x', userId: 'v' }, 'me')).toBe(true);
    expect(canUnban('mod', { bannedBy: 'me', userId: 'v' }, 'me')).toBe(true);
    expect(canUnban('mod', { bannedBy: 'x', userId: 'v' }, 'me')).toBe(false);
    expect(canUnban('mod', { bannedBy: null, userId: 'v' }, 'me')).toBe(false);
    expect(canUnban('member', { bannedBy: 'me', userId: 'v' }, 'me')).toBe(false);
    expect(canUnban('admin', { bannedBy: 'x', userId: 'me' }, 'me')).toBe(false);
  });
});
