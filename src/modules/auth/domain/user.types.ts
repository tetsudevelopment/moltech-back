export interface User {
  id: string;
  email: string | null;
  passwordHash: string | null;
  nombres: string;
  apellidos: string;
  telefono: string | null;
  authProvider: 'email' | 'google' | 'facebook';
  estado: 'activo' | 'suspendido' | 'inactivo';
  createdAt: Date;
}

export type PublicUser = Omit<User, 'passwordHash'>;
