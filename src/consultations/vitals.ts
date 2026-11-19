export type VitalStatus = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';

export interface VitalsInput {
  temperatureC?: number | null;
  systolic?: number | null;
  diastolic?: number | null;
  pulse?: number | null;
  weightKg?: number | null;
  heightCm?: number | null;
}

export interface VitalFlags {
  temperature: VitalStatus | null;
  pulse: VitalStatus | null;
  bloodPressure: VitalStatus | null;
  bmi: { status: VitalStatus; category: 'Underweight' | 'Normal' | 'Overweight' | 'Obese' } | null;
  /** Pulse, blood pressure and BMI use adult reference ranges, so they are not assessed for under-18s. */
  adultRangesOnly: boolean;
}

const has = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);

export function computeBmi(weightKg?: number | null, heightCm?: number | null): number | null {
  if (!has(weightKg) || !has(heightCm) || heightCm <= 0) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

/** Blood pressure needs both numbers, and systolic must be higher than diastolic. */
export function validateVitalCombination(v: VitalsInput): string | null {
  if (has(v.systolic) !== has(v.diastolic)) return 'Enter both systolic and diastolic blood pressure';
  if (has(v.systolic) && has(v.diastolic) && v.systolic <= v.diastolic) return 'Systolic pressure must be higher than diastolic';
  return null;
}

/**
 * Screening flags to draw the doctor's eye, NOT a diagnosis. Thresholds are common adult reference values
 * (fever at 37.5 C, hypertension at 140/90, BMI bands from WHO) and should be reviewed by the clinic's doctors.
 */
export function assessVitals(v: VitalsInput & { bmi?: number | null }, age: number): VitalFlags {
  const adult = age >= 18;

  const temperature = !has(v.temperatureC) ? null
    : v.temperatureC < 35 || v.temperatureC >= 40 ? 'CRITICAL'
    : v.temperatureC < 36 ? 'LOW'
    : v.temperatureC >= 37.5 ? 'HIGH'
    : 'NORMAL';

  const pulse = !adult || !has(v.pulse) ? null
    : v.pulse < 40 || v.pulse >= 130 ? 'CRITICAL'
    : v.pulse < 60 ? 'LOW'
    : v.pulse > 100 ? 'HIGH'
    : 'NORMAL';

  let bloodPressure: VitalStatus | null = null;
  if (adult && has(v.systolic) && has(v.diastolic)) {
    const { systolic: s, diastolic: d } = v;
    bloodPressure = s >= 180 || d >= 120 || s < 80 || d < 50 ? 'CRITICAL' : s >= 140 || d >= 90 ? 'HIGH' : s < 90 || d < 60 ? 'LOW' : 'NORMAL';
  }

  const bmiValue = v.bmi ?? computeBmi(v.weightKg, v.heightCm);
  const bmi: VitalFlags['bmi'] = !adult || !has(bmiValue) ? null
    : bmiValue < 18.5 ? { status: 'LOW', category: 'Underweight' }
    : bmiValue < 25 ? { status: 'NORMAL', category: 'Normal' }
    : bmiValue < 30 ? { status: 'HIGH', category: 'Overweight' }
    : { status: 'HIGH', category: 'Obese' };

  return { temperature, pulse, bloodPressure, bmi, adultRangesOnly: !adult };
}

/** Prisma returns Decimal columns as objects; the API exposes plain numbers plus the screening flags. */
export function toVitalsView(
  v: { temperatureC: unknown; systolic: number | null; diastolic: number | null; pulse: number | null; weightKg: unknown; heightCm: unknown; bmi: unknown; recordedAt: Date; recordedBy?: { id: string; fullName: string } },
  age: number,
) {
  const num = (x: unknown) => (x === null || x === undefined ? null : Number(x));
  const values = { temperatureC: num(v.temperatureC), systolic: v.systolic, diastolic: v.diastolic, pulse: v.pulse, weightKg: num(v.weightKg), heightCm: num(v.heightCm), bmi: num(v.bmi) };
  return { ...values, recordedAt: v.recordedAt, recordedBy: v.recordedBy ?? null, flags: assessVitals(values, age) };
}
