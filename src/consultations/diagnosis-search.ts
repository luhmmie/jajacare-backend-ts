export interface DiagnosisSuggestion {
  name: string;
  code: string | null;
  source: 'catalog' | 'history';
}

/** Common presentations at a university clinic, with WHO ICD-10 codes. A convenience list; the doctor may type anything. */
export const DIAGNOSIS_CATALOG: { name: string; code: string }[] = [
  { name: 'Malaria', code: 'B54' },
  { name: 'Typhoid fever', code: 'A01.0' },
  { name: 'Upper respiratory tract infection', code: 'J06.9' },
  { name: 'Acute pharyngitis', code: 'J02.9' },
  { name: 'Acute tonsillitis', code: 'J03.9' },
  { name: 'Acute sinusitis', code: 'J01.9' },
  { name: 'Acute bronchitis', code: 'J20.9' },
  { name: 'Asthma', code: 'J45.9' },
  { name: 'Allergic rhinitis', code: 'J30.4' },
  { name: 'Cough', code: 'R05' },
  { name: 'Fever, unspecified', code: 'R50.9' },
  { name: 'Headache', code: 'R51' },
  { name: 'Migraine', code: 'G43.9' },
  { name: 'Hypertension', code: 'I10' },
  { name: 'Type 2 diabetes mellitus', code: 'E11.9' },
  { name: 'Anaemia', code: 'D64.9' },
  { name: 'Urinary tract infection', code: 'N39.0' },
  { name: 'Vulvovaginal candidiasis', code: 'B37.3' },
  { name: 'Dysmenorrhoea', code: 'N94.6' },
  { name: 'Gastroenteritis', code: 'A09' },
  { name: 'Food poisoning', code: 'A05.9' },
  { name: 'Gastritis', code: 'K29.7' },
  { name: 'Peptic ulcer disease', code: 'K27.9' },
  { name: 'Gastro-oesophageal reflux disease', code: 'K21.9' },
  { name: 'Constipation', code: 'K59.0' },
  { name: 'Haemorrhoids', code: 'K64.9' },
  { name: 'Low back pain', code: 'M54.5' },
  { name: 'Myalgia', code: 'M79.1' },
  { name: 'Dermatitis', code: 'L30.9' },
  { name: 'Urticaria', code: 'L50.9' },
  { name: 'Acne', code: 'L70.9' },
  { name: 'Fungal skin infection (dermatophytosis)', code: 'B35.9' },
  { name: 'Scabies', code: 'B86' },
  { name: 'Conjunctivitis', code: 'H10.9' },
  { name: 'Otitis media', code: 'H66.9' },
  { name: 'Dental caries', code: 'K02.9' },
  { name: 'Anxiety disorder', code: 'F41.9' },
  { name: 'Depressive episode', code: 'F32.9' },
  { name: 'COVID-19', code: 'U07.1' },
];

/**
 * Ranks name-prefix matches first, then other matches; catalogue entries before names previously used in this
 * clinic (`used`, passed most-used-first), with no duplicates by name.
 */
export function searchDiagnoses(query: string, used: { name: string }[], limit = 10): DiagnosisSuggestion[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const candidates: DiagnosisSuggestion[] = [
    ...DIAGNOSIS_CATALOG.map((d) => ({ ...d, source: 'catalog' as const })),
    ...used.map((u) => ({ name: u.name, code: null, source: 'history' as const })),
  ];

  const seen = new Set<string>();
  const scored: { s: DiagnosisSuggestion; rank: number; order: number }[] = [];
  candidates.forEach((s, order) => {
    const key = s.name.toLowerCase();
    if (seen.has(key)) return;
    const name = key;
    const code = (s.code ?? '').toLowerCase();
    const rank = name.startsWith(q) || code.startsWith(q) ? 0 : name.includes(q) || code.includes(q) ? 1 : -1;
    if (rank < 0) return;
    seen.add(key);
    scored.push({ s, rank, order });
  });
  return scored.sort((a, b) => a.rank - b.rank || a.order - b.order).slice(0, limit).map((x) => x.s);
}
