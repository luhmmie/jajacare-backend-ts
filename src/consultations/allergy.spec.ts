import { findAllergyConflicts } from './allergy';

describe('findAllergyConflicts', () => {
  it('flags a drug in the allergy family (penicillin allergy, amoxicillin prescribed)', () => {
    expect(findAllergyConflicts(['Penicillin'], ['Amoxicillin 500mg'])).toEqual([{ drug: 'Amoxicillin 500mg', allergy: 'Penicillin' }]);
  });
  it('knows Nigerian brand names (sulfa allergy, Septrin / Fansidar)', () => {
    expect(findAllergyConflicts(['Sulfa drugs'], ['Septrin', 'Fansidar'])).toHaveLength(2);
  });
  it('flags NSAIDs for an NSAID or aspirin allergy', () => {
    expect(findAllergyConflicts(['NSAIDs'], ['Ibuprofen'])).toHaveLength(1);
    expect(findAllergyConflicts(['Aspirin'], ['Diclofenac'])).toHaveLength(1);
  });
  it('flags a direct name match, in either direction', () => {
    expect(findAllergyConflicts(['Chloroquine'], ['chloroquine phosphate'])).toHaveLength(1);
  });
  it('does not flag unrelated drugs', () => {
    expect(findAllergyConflicts(['Penicillin'], ['Paracetamol', 'Artemether-lumefantrine'])).toEqual([]);
  });
  it('handles empty lists and blank entries', () => {
    expect(findAllergyConflicts([], ['Paracetamol'])).toEqual([]);
    expect(findAllergyConflicts(['Penicillin'], [])).toEqual([]);
    expect(findAllergyConflicts(['  '], ['Paracetamol'])).toEqual([]);
  });
});
