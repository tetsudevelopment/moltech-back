export type UserStatus = 'active' | 'suspended' | 'inactive' | 'pending_verification';

export type AuthProvider = 'email' | 'google' | 'facebook';

export interface User {
  id: string;
  email: string | null;
  passwordHash: string | null;
  firstName: string;
  lastName: string;
  phone: string | null;
  authProvider: AuthProvider;
  authProviderId: string | null;
  status: UserStatus;
  emailVerified: boolean;
  createdAt: Date;
}

export type PublicUser = Omit<User, 'passwordHash'>;
