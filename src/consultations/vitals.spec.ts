import { assessVitals, computeBmi, toVitalsView, validateVitalCombination } from './vitals';

describe('computeBmi', () => {
  it('rounds to one decimal', () => expect(computeBmi(70, 175)).toBe(22.9));
  it('needs both weight and height', () => {
    expect(computeBmi(70, null)).toBeNull();
    expect(computeBmi(undefined, 175)).toBeNull();
    expect(computeBmi(70, 0)).toBeNull();
  });
});

describe('validateVitalCombination', () => {
  it('requires both blood pressure numbers together', () => {
    expect(validateVitalCombination({ systolic: 120 })).toContain('both');
    expect(validateVitalCombination({ diastolic: 80 })).toContain('both');
  });
  it('requires systolic above diastolic', () => {
    expect(validateVitalCombination({ systolic: 80, diastolic: 80 })).toContain('higher');
  });
  it('accepts a valid pair or no blood pressure at all', () => {
    expect(validateVitalCombination({ systolic: 120, diastolic: 80 })).toBeNull();
    expect(validateVitalCombination({ temperatureC: 37 })).toBeNull();
  });
});

describe('assessVitals (adult)', () => {
  const adult = 25;
  it('flags temperature bands', () => {
    expect(assessVitals({ temperatureC: 36.6 }, adult).temperature).toBe('NORMAL');
    expect(assessVitals({ temperatureC: 35.5 }, adult).temperature).toBe('LOW');
    expect(assessVitals({ temperatureC: 38.2 }, adult).temperature).toBe('HIGH');
    expect(assessVitals({ temperatureC: 40.1 }, adult).temperature).toBe('CRITICAL');
    expect(assessVitals({ temperatureC: 34.5 }, adult).temperature).toBe('CRITICAL');
  });
  it('flags pulse bands', () => {
    expect(assessVitals({ pulse: 72 }, adult).pulse).toBe('NORMAL');
    expect(assessVitals({ pulse: 52 }, adult).pulse).toBe('LOW');
    expect(assessVitals({ pulse: 112 }, adult).pulse).toBe('HIGH');
    expect(assessVitals({ pulse: 135 }, adult).pulse).toBe('CRITICAL');
  });
  it('flags blood pressure bands', () => {
    expect(assessVitals({ systolic: 118, diastolic: 76 }, adult).bloodPressure).toBe('NORMAL');
    expect(assessVitals({ systolic: 150, diastolic: 85 }, adult).bloodPressure).toBe('HIGH');
    expect(assessVitals({ systolic: 125, diastolic: 95 }, adult).bloodPressure).toBe('HIGH');
    expect(assessVitals({ systolic: 85, diastolic: 55 }, adult).bloodPressure).toBe('LOW');
    expect(assessVitals({ systolic: 185, diastolic: 100 }, adult).bloodPressure).toBe('CRITICAL');
  });
  it('categorises BMI', () => {
    expect(assessVitals({ weightKg: 50, heightCm: 175 }, adult).bmi).toEqual({ status: 'LOW', category: 'Underweight' });
    expect(assessVitals({ weightKg: 70, heightCm: 175 }, adult).bmi).toEqual({ status: 'NORMAL', category: 'Normal' });
    expect(assessVitals({ weightKg: 85, heightCm: 175 }, adult).bmi).toEqual({ status: 'HIGH', category: 'Overweight' });
    expect(assessVitals({ weightKg: 100, heightCm: 175 }, adult).bmi).toEqual({ status: 'HIGH', category: 'Obese' });
  });
  it('flags nothing for values that were not recorded', () => {
    expect(assessVitals({}, adult)).toEqual({ temperature: null, pulse: null, bloodPressure: null, bmi: null, adultRangesOnly: false });
  });
});

describe('assessVitals (under 18)', () => {
  it('still flags temperature but does not apply adult pulse, BP or BMI ranges', () => {
    const f = assessVitals({ temperatureC: 39, pulse: 120, systolic: 150, diastolic: 95, weightKg: 40, heightCm: 160 }, 16);
    expect(f.temperature).toBe('HIGH');
    expect(f.pulse).toBeNull();
    expect(f.bloodPressure).toBeNull();
    expect(f.bmi).toBeNull();
    expect(f.adultRangesOnly).toBe(true);
  });
});

describe('toVitalsView', () => {
  it('converts Decimal-like values to numbers and attaches flags', () => {
    const view = toVitalsView({ temperatureC: { valueOf: () => 38.4, toString: () => '38.4' }, systolic: 120, diastolic: 80, pulse: 80, weightKg: '70.0', heightCm: '175.0', bmi: '22.9', recordedAt: new Date('2026-11-17') }, 25);
    expect(view.temperatureC).toBe(38.4);
    expect(view.weightKg).toBe(70);
    expect(view.flags.temperature).toBe('HIGH');
  });
});
