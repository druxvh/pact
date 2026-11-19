import { describe, expect, it } from 'vitest';
import { describeError, toAttachments, toCommunityError, toInvite, toMessage } from './mapping';
import { CommunityError } from './types';

describe('rows → app types', () => {
  it('maps a message row, with safe defaults for anything missing', () => {
    const m = toMessage({
      id: 'm1',
      community_id: 'c',
      channel_id: 'ch',
      author_id: 'u',
      body: 'hi',
      attachments: [{ path: 'c/u/a.png', name: 'a.png', type: 'image/png', size: 5, width: 10, height: 20 }],
      created_at: '2026-01-01T00:00:00Z',
    });
    expect(m).toMatchObject({ id: 'm1', body: 'hi', replyTo: null, hiddenAt: null, deletedAt: null, hiddenReason: '' });
    expect(m.attachments[0]).toEqual({ path: 'c/u/a.png', name: 'a.png', type: 'image/png', size: 5, width: 10, height: 20 });
    expect(toMessage({}).attachments).toEqual([]);
  });
  it('ignores malformed attachments instead of crashing the whole channel', () => {
    expect(toAttachments(null)).toEqual([]);
    expect(toAttachments([{ nope: 1 }, 'x', null, { path: 'c/u/ok.gif' }])).toEqual([
      { path: 'c/u/ok.gif', name: 'file', type: 'application/octet-stream', size: 0 },
    ]);
  });
  it('maps invites', () => {
    expect(toInvite({ code: 'abc', max_uses: 5, uses: 2, expires_at: '2026-01-01', created_at: '2025-01-01', created_by: 'u' })).toEqual({
      code: 'abc',
      maxUses: 5,
      uses: 2,
      expiresAt: '2026-01-01',
      createdAt: '2025-01-01',
      createdBy: 'u',
    });
    expect(toInvite({ code: 'abc' }).maxUses).toBeNull();
  });
});

describe('errors', () => {
  it('recognises the codes the database raises', () => {
    for (const code of ['rate_limited', 'banned', 'too_many_communities', 'community_limit', 'not_allowed'] as const) {
      expect(toCommunityError({ code: 'P0001', message: code }).code).toBe(code);
    }
  });
  it('maps row-level-security, missing rows, duplicates, limits, size, type and network failures', () => {
    expect(toCommunityError({ code: '42501', message: 'new row violates row-level security policy' }).code).toBe('not_allowed');
    expect(toCommunityError({ status: 403, message: 'x' }).code).toBe('not_allowed');
    expect(toCommunityError({ code: 'PGRST116', message: 'no rows' }).code).toBe('not_found');
    expect(toCommunityError({ code: '23505', message: 'dup' }).message).toBe('That already exists.');
    expect(toCommunityError({ code: '23514', message: 'check' }).message).toContain('limits');
    expect(toCommunityError({ statusCode: '413', message: 'The object exceeded the maximum allowed size' }).code).toBe('too_large');
    expect(toCommunityError({ message: 'mime type text/plain is not supported' }).code).toBe('bad_type');
    expect(toCommunityError(new TypeError('Failed to fetch')).code).toBe('network');
  });
  it('passes CommunityErrors through and gives every code a human sentence', () => {
    const e = new CommunityError('banned');
    expect(toCommunityError(e)).toBe(e);
    for (const code of [
      'rate_limited',
      'banned',
      'too_many_communities',
      'community_limit',
      'not_allowed',
      'not_found',
      'too_large',
      'bad_type',
      'network',
    ] as const) {
      expect(describeError(new CommunityError(code)).length).toBeGreaterThan(10);
    }
    expect(describeError(new Error('weird'))).toBe('weird');
  });
});
