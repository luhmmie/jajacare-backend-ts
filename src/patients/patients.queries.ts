import { Prisma } from '@prisma/client';
import { ListPatientsQueryDto } from './dto/patient.dto';

/** Each whitespace-separated word must match at least one searchable field ("ada obi" finds Obi, Ada). */
export function buildPatientWhere(q: Pick<ListPatientsQueryDto, 'search' | 'faculty' | 'registeredFrom' | 'registeredTo'>): Prisma.PatientWhereInput {
  const tokens = (q.search ?? '').split(/\s+/).filter(Boolean);

  let registeredTo: Date | undefined;
  if (q.registeredTo) {
    registeredTo = new Date(q.registeredTo);
    registeredTo.setUTCHours(23, 59, 59, 999);
  }

  return {
    deletedAt: null, // soft-deleted patients never appear in normal queries
    faculty: q.faculty ? { equals: q.faculty, mode: 'insensitive' } : undefined,
    createdAt: q.registeredFrom || registeredTo ? { gte: q.registeredFrom, lte: registeredTo } : undefined,
    AND: tokens.map((t) => ({
      OR: [
        { firstName: { contains: t, mode: 'insensitive' as const } },
        { lastName: { contains: t, mode: 'insensitive' as const } },
        { patientNo: { contains: t, mode: 'insensitive' as const } },
        { matricNumber: { contains: t, mode: 'insensitive' as const } },
        { staffNumber: { contains: t, mode: 'insensitive' as const } },
      ],
    })),
  };
}

/** Always ends with id as a tie-breaker so pagination is stable. */
export function buildPatientOrderBy(q: Pick<ListPatientsQueryDto, 'sortBy' | 'order'>): Prisma.PatientOrderByWithRelationInput[] {
  const dir: Prisma.SortOrder = q.order;
  switch (q.sortBy) {
    case 'name': return [{ lastName: dir }, { firstName: dir }, { id: 'asc' }];
    case 'patientNo': return [{ patientNo: dir }, { id: 'asc' }];
    case 'faculty': return [{ faculty: dir }, { lastName: 'asc' }, { id: 'asc' }];
    // Older = earlier date of birth, so sorting by age is the reverse of sorting by DOB.
    case 'age': return [{ dateOfBirth: dir === 'asc' ? 'desc' : 'asc' }, { id: 'asc' }];
    default: return [{ createdAt: dir }, { id: 'asc' }];
  }
}
