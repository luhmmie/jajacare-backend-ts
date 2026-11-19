import { Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  staffId: string;
  fullName: string;
  role: Role;
  mustChangePassword: boolean;
}
