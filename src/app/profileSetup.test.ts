import { describe, expect, it } from 'vitest';
import { useUserStore } from '@/store/useUserStore';
import { profileStepError, suggestUsername } from './profileSetup';

describe('suggestUsername', () => {
  it('turns a name into a valid handle', () => {
    expect(suggestUsername('Sam Okafor')).toBe('samokafor');
    expect(suggestUsername('  Zoë  O’Brien ')).toBe('zoeobrien');
    expect(suggestUsername('Ünal')).toBe('unal');
  });
  it('gives up (empty) when nothing usable remains, and caps the length', () => {
    expect(suggestUsername('李雷')).toBe('');
    expect(suggestUsername('Al')).toBe('');
    expect(suggestUsername('a'.repeat(50))).toHaveLength(20);
  });
});

describe('profileStepError', () => {
  it('needs a name and a valid username', () => {
    expect(profileStepError('', 'sam')).toMatch(/call you/);
    expect(profileStepError('   ', 'sam')).toMatch(/call you/);
    expect(profileStepError('Sam', 'ab')).toMatch(/3 characters/);
    expect(profileStepError('Sam', 'no spaces')).toMatch(/underscores/);
    expect(profileStepError('Sam', '@Sam_1')).toBeNull();
  });
});

describe('user store migration', () => {
  it('drops the legacy "spaces" and keeps what still matters', () => {
    const migrate = useUserStore.persist.getOptions().migrate;
    const out = migrate?.(
      {
        currentUser: { id: 'local-user', displayName: 'Sam', username: 'sam', isOnline: true },
        spaces: [{ id: 's1', name: 'old' }],
        friendIds: ['alex'],
        onboarded: true,
      },
      3,
    ) as unknown as Record<string, unknown>;
    expect(out).not.toHaveProperty('spaces');
    expect(out.friendIds).toEqual(['alex']);
    expect(out.onboarded).toBe(true);
    expect((out.currentUser as { displayName: string }).displayName).toBe('Sam');
  });
});
