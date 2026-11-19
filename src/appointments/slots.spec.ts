import { findSlot, generateSlots, SlotSettings } from './slots';

const settings: SlotSettings = { openTime: '08:00', closeTime: '16:00', slotMinutes: 20, workingDays: [1, 2, 3, 4, 5] };
const MONDAY = '2026-11-16';
const SUNDAY = '2026-11-15';

describe('generateSlots', () => {
  it('fills the working day with back-to-back slots', () => {
    const slots = generateSlots(MONDAY, settings);
    expect(slots).toHaveLength(24);
    expect(slots[0].startsAt.toISOString()).toBe('2026-11-16T07:00:00.000Z'); // 08:00 Lagos
    expect(slots[23].endsAt.toISOString()).toBe('2026-11-16T15:00:00.000Z'); // 16:00 Lagos
  });
  it('offers nothing on a non-working day', () => {
    expect(generateSlots(SUNDAY, settings)).toEqual([]);
  });
  it('drops a trailing slot that would run past closing time', () => {
    expect(generateSlots(MONDAY, { ...settings, closeTime: '08:50' })).toHaveLength(2);
  });
  it('respects a different slot length', () => {
    expect(generateSlots(MONDAY, { ...settings, slotMinutes: 30 })).toHaveLength(16);
  });
});

describe('findSlot', () => {
  it('accepts an exact slot start', () => {
    expect(findSlot(new Date('2026-11-16T07:20:00Z'), settings)).toBeDefined();
  });
  it('rejects an off-grid time', () => {
    expect(findSlot(new Date('2026-11-16T07:10:00Z'), settings)).toBeUndefined();
  });
  it('rejects a time before opening, at closing and on a closed day', () => {
    expect(findSlot(new Date('2026-11-16T06:40:00Z'), settings)).toBeUndefined();
    expect(findSlot(new Date('2026-11-16T15:00:00Z'), settings)).toBeUndefined();
    expect(findSlot(new Date('2026-11-15T07:00:00Z'), settings)).toBeUndefined();
  });
});
