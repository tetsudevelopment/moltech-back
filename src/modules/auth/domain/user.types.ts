export interface User {
  id: string;
  email: string | null;
  passwordHash: string | null;
  firstName: string;
  lastName: string;
  phone: string | null;
  authProvider: 'email' | 'google' | 'facebook';
  status: 'active' | 'suspended' | 'inactive';
  createdAt: Date;
}

export type PublicUser = Omit<User, 'passwordHash'>;
