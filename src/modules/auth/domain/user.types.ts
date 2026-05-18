export type UserStatus = 'active' | 'suspended' | 'inactive' | 'pending_verification';

export interface User {
  id: string;
  email: string | null;
  passwordHash: string | null;
  firstName: string;
  lastName: string;
  phone: string | null;
  authProvider: 'email' | 'google' | 'facebook';
  status: UserStatus;
  emailVerified: boolean;
  createdAt: Date;
}

export type PublicUser = Omit<User, 'passwordHash'>;
