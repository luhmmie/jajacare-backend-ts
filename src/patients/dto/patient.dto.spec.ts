import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreatePatientDto, ListPatientsQueryDto } from './patient.dto';

const valid = () => ({
  firstName: ' Ada ',
  lastName: 'Obi',
  gender: 'FEMALE',
  dateOfBirth: '2002-05-14',
  phone: '08031234567',
  matricNumber: ' 123456 ',
  faculty: 'Science',
  department: 'Computer Science',
  emergencyContact: { name: 'Chioma Obi', relationship: 'Sister', phone: '+2348031234567' },
  bloodGroup: 'O_POS',
  genotype: 'AA',
  allergies: [{ substance: 'Penicillin', reaction: 'Rash' }],
  chronicConditions: ['Asthma'],
});

const check = (payload: unknown) => validateSync(plainToInstance(CreatePatientDto, payload), { whitelist: true, forbidNonWhitelisted: true });
const fieldsWithErrors = (payload: unknown) => check(payload).map((e) => e.property);

describe('CreatePatientDto', () => {
  it('accepts a complete valid payload and trims / normalises input', () => {
    const dto = plainToInstance(CreatePatientDto, valid());
    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.firstName).toBe('Ada');
    expect(dto.matricNumber).toBe('123456');
    expect(dto.dateOfBirth).toBeInstanceOf(Date);
  });

  it('rejects an invalid phone number', () => {
    expect(fieldsWithErrors({ ...valid(), phone: '12345' })).toContain('phone');
  });

  it('rejects a future date of birth', () => {
    expect(fieldsWithErrors({ ...valid(), dateOfBirth: '2999-01-01' })).toContain('dateOfBirth');
  });

  it('requires an emergency contact with a valid phone', () => {
    const { emergencyContact: _omit, ...rest } = valid();
    expect(fieldsWithErrors(rest)).toContain('emergencyContact');
    expect(fieldsWithErrors({ ...valid(), emergencyContact: { name: 'X', relationship: 'Y', phone: 'nope' } })).toContain('emergencyContact');
  });

  it('rejects unknown fields (no mass-assignment of patientNo, createdById, deletedAt)', () => {
    expect(fieldsWithErrors({ ...valid(), patientNo: 'JC-1999-0001', deletedAt: null })).toEqual(expect.arrayContaining(['patientNo', 'deletedAt']));
  });

  it('rejects an invalid blood group', () => {
    expect(fieldsWithErrors({ ...valid(), bloodGroup: 'Z+' })).toContain('bloodGroup');
  });
});

describe('ListPatientsQueryDto', () => {
  it('applies defaults and coerces query-string numbers', () => {
    const q = plainToInstance(ListPatientsQueryDto, { page: '2', limit: '50' });
    expect(validateSync(q)).toHaveLength(0);
    expect(q).toMatchObject({ page: 2, limit: 50, sortBy: 'createdAt', order: 'desc' });
  });

  it('rejects sorting by a field that is not whitelisted', () => {
    expect(validateSync(plainToInstance(ListPatientsQueryDto, { sortBy: 'passwordHash' })).map((e) => e.property)).toContain('sortBy');
  });

  it('caps page size at 100', () => {
    expect(validateSync(plainToInstance(ListPatientsQueryDto, { limit: '1000' })).map((e) => e.property)).toContain('limit');
  });
});
