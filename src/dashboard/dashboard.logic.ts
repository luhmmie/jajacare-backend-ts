import { DAY_MS, lagosDate } from '../common/clinic-time';

/** The last `n` Lagos calendar days ending on `today`, oldest first (the order a line chart wants). */
export function lastNDays(n: number, today: string): string[] {
  const base = new Date(`${today}T12:00:00Z`).getTime();
  return Array.from({ length: n }, (_, i) => new Date(base - (n - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

/** Counts instants per Lagos day, with a zero for days that had none so the chart never has gaps. */
export function bucketVisits(instants: Date[], days: string[]): { date: string; visits: number }[] {
  const counts = new Map(days.map((d) => [d, 0]));
  for (const at of instants) {
    const key = lagosDate(at);
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return days.map((date) => ({ date, visits: counts.get(date) ?? 0 }));
}

export type ActivityType = 'patient.registered' | 'appointment.booked' | 'consultation.completed';

export interface ActivityItem {
  type: ActivityType;
  at: Date;
  message: string;
  patient: { id: string; patientNo: string; name: string };
  doctor: string | null;
  by: string | null;
}

/** Newest first across all sources, trimmed to `limit`. */
export function mergeActivity(groups: ActivityItem[][], limit: number): ActivityItem[] {
  return groups.flat().sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}
