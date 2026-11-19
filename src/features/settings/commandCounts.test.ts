import { describe, expect, it } from 'vitest';
import { countCommands } from './commandCounts';

describe('countCommands', () => {
  it('is all zeros with no commands', () => {
    expect(countCommands([])).toEqual({ quicklink: 0, snippet: 0, alias: 0 });
  });

  it('counts each kind', () => {
    const items = [{ kind: 'quicklink' }, { kind: 'snippet' }, { kind: 'snippet' }, { kind: 'alias' }, { kind: 'quicklink' }, { kind: 'quicklink' }] as const;
    expect(countCommands(items)).toEqual({ quicklink: 3, snippet: 2, alias: 1 });
  });

  it('ignores a kind it does not know instead of inventing a bucket', () => {
    expect(countCommands([{ kind: 'bogus' } as never, { kind: 'alias' }])).toEqual({ quicklink: 0, snippet: 0, alias: 1 });
  });
});
