import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  AUDIT_RECORDED_EVENT,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';
import type { User } from '@/modules/auth/domain/user.types';
import { UserRepository } from '@/modules/auth/repositories/user.repository';

import { AdminUsersService } from './admin-users.service';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function userFixture(overrides: Partial<User> = {}): User {
  return {
    id: USER_ID,
    email: 'user@example.com',
    passwordHash: null,
    firstName: 'John',
    lastName: 'Doe',
    phone: null,
    authProvider: 'email',
    authProviderId: null,
    role: 'user',
    status: 'active',
    emailVerified: true,
    createdAt: new Date('2026-05-18T10:00:00Z'),
    ...overrides,
  };
}

describe('AdminUsersService', () => {
  let service: AdminUsersService;
  let users: jest.Mocked<UserRepository>;
  let emitter: { emit: jest.Mock };

  beforeEach(async () => {
    users = {
      findById: jest.fn(),
      listAll: jest.fn(),
      updateRole: jest.fn(),
    } as unknown as jest.Mocked<UserRepository>;
    emitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminUsersService,
        { provide: UserRepository, useValue: users },
        { provide: EventEmitter2, useValue: emitter },
      ],
    }).compile();
    service = module.get(AdminUsersService);
  });

  describe('findById()', () => {
    it('throws USER_NOT_FOUND when missing', async () => {
      users.findById.mockResolvedValue(null);
      await expect(service.findById(USER_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateRole()', () => {
    it('rejects self-role-change with CANNOT_CHANGE_OWN_ROLE', async () => {
      await expect(service.updateRole(ACTOR_ID, ACTOR_ID, 'admin')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(users.findById).not.toHaveBeenCalled();
      expect(users.updateRole).not.toHaveBeenCalled();
    });

    it('throws USER_NOT_FOUND when target user is missing', async () => {
      users.findById.mockResolvedValue(null);
      await expect(service.updateRole(USER_ID, ACTOR_ID, 'admin')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('is a no-op (but still audits) when role unchanged', async () => {
      users.findById.mockResolvedValue(userFixture({ role: 'admin' }));
      const result = await service.updateRole(USER_ID, ACTOR_ID, 'admin');
      expect(users.updateRole).not.toHaveBeenCalled();
      expect(result.role).toBe('admin');
      expect(emitter.emit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining({
          action: 'admin.user.role_changed',
          metadata: expect.objectContaining({ noop: true }) as unknown,
        }),
      );
    });

    it('promotes user → admin and emits with previousRole/newRole', async () => {
      users.findById.mockResolvedValue(userFixture({ role: 'user' }));
      users.updateRole.mockResolvedValue(userFixture({ role: 'admin' }));

      const result = await service.updateRole(USER_ID, ACTOR_ID, 'admin');

      expect(users.updateRole).toHaveBeenCalledWith(USER_ID, 'admin');
      expect(result.role).toBe('admin');
      expect(emitter.emit).toHaveBeenCalledWith(
        AUDIT_RECORDED_EVENT,
        expect.objectContaining<Partial<AuditRecordedEvent>>({
          action: 'admin.user.role_changed',
        }),
      );
    });
  });
});
