import { Prisma } from '@prisma/client';

/** Makes any Prisma result (Dates, Decimals) safe to store in a JSON audit column. */
export const toJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
