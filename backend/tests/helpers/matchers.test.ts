import { describe, it, expect } from 'vitest';

describe('custom asymmetric matchers', () => {
  it('arrayContainingExactly matches same items regardless of order and no extras', () => {
    expect([{ id: 1 }, { id: 2 }]).toEqual(
      expect.arrayContainingExactly([expect.objectContaining({ id: 2 }), expect.objectContaining({ id: 1 })]),
    );
  });

  it('objectContainingExactly matches same keys only', () => {
    expect({ id: 1, name: 'Yor' }).toEqual(
      expect.objectContainingExactly({
        id: 1,
        name: 'Yor',
      }),
    );
  });

  it('objectContainingExactly fails when extra keys are present', () => {
    expect({ id: 1, name: 'Yor', extra: true }).not.toEqual(
      expect.objectContainingExactly({
        id: 1,
        name: 'Yor',
      }),
    );
  });
});

