export interface AllergyConflict {
  drug: string;
  allergy: string;
}

/**
 * Drug families a patient may be allergic to, written the way Nigerian clinics write them
 * (brand names included). `aliases` match the allergy text; `members` match the drug being prescribed.
 * This is a safety net for obvious cases, not a drug-interaction database.
 */
const FAMILIES: { aliases: string[]; members: string[] }[] = [
  { aliases: ['penicillin', 'amoxicillin', 'ampicillin', 'beta-lactam', 'beta lactam'], members: ['penicillin', 'amoxicillin', 'amoxil', 'ampicillin', 'cloxacillin', 'flucloxacillin', 'augmentin', 'co-amoxiclav', 'amoxiclav', 'piperacillin'] },
  { aliases: ['sulfa', 'sulpha', 'sulphonamide', 'sulfonamide', 'septrin', 'cotrimoxazole', 'co-trimoxazole', 'bactrim'], members: ['sulfa', 'sulpha', 'sulfamethoxazole', 'cotrimoxazole', 'co-trimoxazole', 'septrin', 'bactrim', 'sulfadoxine', 'fansidar', 'sulfasalazine'] },
  { aliases: ['nsaid', 'aspirin', 'ibuprofen', 'diclofenac', 'anti-inflammatory'], members: ['aspirin', 'ibuprofen', 'brufen', 'diclofenac', 'voltaren', 'naproxen', 'ketoprofen', 'piroxicam', 'meloxicam', 'celecoxib', 'indomethacin', 'mefenamic', 'ponstan'] },
  { aliases: ['cephalosporin', 'ceftriaxone', 'cefuroxime', 'cefixime'], members: ['cephalosporin', 'ceftriaxone', 'cefuroxime', 'cefixime', 'cefalexin', 'cephalexin', 'cefpodoxime', 'ceftazidime', 'cefotaxime'] },
  { aliases: ['quinolone', 'ciprofloxacin', 'levofloxacin'], members: ['ciprofloxacin', 'ciprotab', 'levofloxacin', 'ofloxacin', 'norfloxacin', 'moxifloxacin'] },
];

const norm = (s: string) => s.toLowerCase().trim();

export function findAllergyConflicts(allergies: string[], drugs: string[]): AllergyConflict[] {
  const conflicts: AllergyConflict[] = [];
  for (const drug of drugs) {
    const d = norm(drug);
    for (const allergy of allergies) {
      const a = norm(allergy);
      if (!a || !d) continue;
      const direct = d.includes(a) || (d.length >= 4 && a.includes(d));
      const family = FAMILIES.some((f) => f.aliases.some((al) => a.includes(al)) && f.members.some((m) => d.includes(m)));
      if (direct || family) conflicts.push({ drug, allergy });
    }
  }
  return conflicts;
}
