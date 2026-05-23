import { z } from 'zod';

const UserRoleSchema = z.enum(['user', 'admin', 'superadmin']);
const UserStatusSchema = z.enum(['active', 'suspended', 'inactive', 'pending_verification']);

export const ListUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
  role: UserRoleSchema.optional(),
  status: UserStatusSchema.optional(),
  search: z.string().trim().max(150).optional(),
});
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;

export const UpdateUserRoleSchema = z.object({
  role: UserRoleSchema,
});
export type UpdateUserRoleDto = z.infer<typeof UpdateUserRoleSchema>;
