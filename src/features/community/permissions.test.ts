import { describe, expect, it } from 'vitest';
import { extractUrls, isPlausibleInviteCode, parseInviteCode } from './links';
import { type Action, can, canActOnMember } from './permissions';

const ACTIONS: Action[] = [
  'post',
  'createInvite',
  'revokeInvite',
  'moderateMessages',
  'createChannel',
  'deleteChannel',
  'editCommunity',
  'deleteCommunity',
  'appointMods',
];

describe('what each role can do', () => {
  it('members can only post', () => {
    expect(ACTIONS.filter((a) => can('member', a))).toEqual(['post']);
  });
  it('moderators can post, invite and moderate messages — nothing structural', () => {
    expect(ACTIONS.filter((a) => can('mod', a))).toEqual(['post', 'createInvite', 'revokeInvite', 'moderateMessages']);
  });
  it('the admin can do everything', () => {
    expect(ACTIONS.every((a) => can('admin', a))).toBe(true);
  });
  it('someone who is not in the community can do nothing', () => {
    expect(ACTIONS.some((a) => can(null, a) || can(undefined, a))).toBe(false);
  });
});

describe('acting on another member', () => {
  it('nobody can touch the admin', () => {
    for (const actor of ['admin', 'mod', 'member'] as const)
      for (const act of ['kick', 'ban', 'setRole'] as const) expect(canActOnMember(actor, 'admin', act)).toBe(false);
  });
  it('only the admin appoints and removes moderators', () => {
    expect(canActOnMember('admin', 'member', 'setRole')).toBe(true);
    expect(canActOnMember('admin', 'mod', 'setRole')).toBe(true);
    expect(canActOnMember('mod', 'member', 'setRole')).toBe(false);
    expect(canActOnMember('member', 'member', 'setRole')).toBe(false);
  });
  it('moderators can remove ordinary members but not other moderators; the admin can remove either', () => {
    for (const act of ['kick', 'ban'] as const) {
      expect(canActOnMember('mod', 'member', act)).toBe(true);
      expect(canActOnMember('mod', 'mod', act)).toBe(false);
      expect(canActOnMember('admin', 'mod', act)).toBe(true);
      expect(canActOnMember('admin', 'member', act)).toBe(true);
      expect(canActOnMember('member', 'member', act)).toBe(false);
    }
  });
});

describe('extractUrls', () => {
  it('finds distinct links in order, without trailing punctuation', () => {
    expect(extractUrls('see https://a.com/x, and (https://b.org/y). again https://a.com/x!')).toEqual(['https://a.com/x', 'https://b.org/y']);
  });
  it('caps the number and ignores non-http schemes', () => {
    expect(extractUrls('https://1.com https://2.com https://3.com https://4.com', 2)).toEqual(['https://1.com', 'https://2.com']);
    expect(extractUrls('javascript:alert(1) ftp://x.com mailto:a@b.c')).toEqual([]);
  });
});

describe('invite codes', () => {
  it('accepts a bare code, any case, with stray spaces', () => {
    expect(parseInviteCode('  ABCDEF0123456789 ')).toBe('abcdef0123456789');
  });
  it('pulls the code out of a pasted link', () => {
    expect(parseInviteCode('chrome-extension://xyz/newtab.html#/chat/join%3Aabcdef0123456789')).toBe('abcdef0123456789');
    expect(parseInviteCode('https://x.test/?invite=abcdef0123456789')).toBe('abcdef0123456789');
  });
  it('recognises the shape the database generates (16 hex characters)', () => {
    expect(isPlausibleInviteCode('abcdef0123456789')).toBe(true);
    for (const bad of ['', 'abc', 'abcdef012345678', 'abcdef01234567890', 'ghijklmnopqrstuv']) expect(isPlausibleInviteCode(bad)).toBe(false);
  });
});
