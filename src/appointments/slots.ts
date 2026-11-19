import { lagosDate, lagosToUtc, lagosWeekday } from '../common/clinic-time';

export interface SlotSettings {
  openTime: string; // HH:mm, Lagos
  closeTime: string;
  slotMinutes: number;
  workingDays: number[]; // 0 = Sunday
}
export interface Slot {
  startsAt: Date;
  endsAt: Date;
}

/** Back-to-back slots from opening time; a slot that would run past closing time is not offered. */
export function generateSlots(date: string, s: SlotSettings): Slot[] {
  if (!s.workingDays.includes(lagosWeekday(date))) return [];
  const open = lagosToUtc(date, s.openTime).getTime();
  const close = lagosToUtc(date, s.closeTime).getTime();
  const step = s.slotMinutes * 60_000;
  const slots: Slot[] = [];
  for (let t = open; t + step <= close; t += step) {
    slots.push({ startsAt: new Date(t), endsAt: new Date(t + step) });
  }
  return slots;
}

/** The slot that starts exactly at `startsAt`, or undefined if it is off-grid, outside hours or on a closed day. */
export function findSlot(startsAt: Date, s: SlotSettings): Slot | undefined {
  return generateSlots(lagosDate(startsAt), s).find((slot) => slot.startsAt.getTime() === startsAt.getTime());
}
