import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ContactService } from './contact.service';
import { CreateContactMessageDto } from './dto/contact.dto';

function build() {
  const prisma: any = {
    contactMessage: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn((arr: Promise<unknown>[]) => Promise.all(arr)),
  };
  const audit = { log: jest.fn() };
  const settings = { get: async () => ({ id: 1, clinicName: 'Jaja Clinic', openTime: '08:00', closeTime: '16:00', workingDays: [1, 2, 3, 4, 5], address: 'UI, Ibadan', contactEmail: 'clinic@ui.edu.ng', contactPhone: '0800', slotMinutes: 20, secretInternalField: 'x' }) };
  return { service: new ContactService(prisma, audit as any, settings as any), prisma, audit };
}
const msg = { name: 'Ada', email: 'ada@example.com', message: 'Is the clinic open on Saturdays?' };

describe('ContactService', () => {
  it('stores a real message with the sender IP', async () => {
    const { service, prisma } = build();
    await expect(service.submit(msg, '1.2.3.4')).resolves.toEqual({ received: true });
    expect(prisma.contactMessage.create).toHaveBeenCalledWith({ data: { ...msg, ip: '1.2.3.4' } });
  });

  it('silently drops a submission that filled the honeypot, answering like a success', async () => {
    const { service, prisma } = build();
    await expect(service.submit({ ...msg, website: 'http://spam.example' })).resolves.toEqual({ received: true });
    expect(prisma.contactMessage.create).not.toHaveBeenCalled();
  });

  it('exposes only the allow-listed clinic fields publicly', async () => {
    const { service } = build();
    const info = await service.clinicInfo();
    expect(Object.keys(info).sort()).toEqual(['address', 'clinicName', 'closeTime', 'contactEmail', 'contactPhone', 'openTime', 'workingDays']);
  });

  it('marks a message read once, and audits it', async () => {
    const { service, prisma, audit } = build();
    prisma.contactMessage.findUnique.mockResolvedValue({ id: 'm1', readAt: null });
    prisma.contactMessage.update.mockResolvedValue({ id: 'm1', readAt: new Date() });
    await service.markRead('m1', 'admin-1');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'contact.mark_read' }));
  });

  it('404s for an unknown message', async () => {
    const { service, prisma } = build();
    prisma.contactMessage.findUnique.mockResolvedValue(null);
    await expect(service.markRead('nope', 'admin-1')).rejects.toThrow(NotFoundException);
  });
});

describe('CreateContactMessageDto', () => {
  const errors = (p: unknown) => validateSync(plainToInstance(CreateContactMessageDto, p)).map((e) => e.property);
  it('accepts a normal message and normalises the email', () => {
    const dto = plainToInstance(CreateContactMessageDto, { ...msg, email: '  ADA@Example.com ' });
    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.email).toBe('ada@example.com');
  });
  it('rejects a bad email, a too-short message and a missing name', () => {
    expect(errors({ ...msg, email: 'nope' })).toContain('email');
    expect(errors({ ...msg, message: 'hi' })).toContain('message');
    expect(errors({ ...msg, name: '' })).toContain('name');
  });
  it('rejects an oversized message', () => {
    expect(errors({ ...msg, message: 'x'.repeat(2001) })).toContain('message');
  });
});
