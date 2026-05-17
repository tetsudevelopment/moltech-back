import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';

import { AUDIT_RECORDED_EVENT } from '@/modules/audit/events/audit-recorded.event';

import { PasswordService } from './password.service';
import { RegisterService } from './register.service';
import { type RegisterDto } from '../dtos/register.dto';
import { EmailAlreadyExistsError, UserRepository } from '../repositories/user.repository';

const mockHash = jest.fn();
const mockCreateWithEmail = jest.fn();
const mockEmit = jest.fn();

const validDto: RegisterDto = {
  email: 'user@example.com',
  password: 'ValidPass1',
  first_name: 'John',
  last_name: 'Doe',
  phone: undefined,
  accepted_policy: true,
};

const fakeUser = {
  id: 'user-uuid-1',
  email: 'user@example.com',
  passwordHash: '$argon2id$hashed',
  firstName: 'John',
  lastName: 'Doe',
  phone: null,
  authProvider: 'email' as const,
  status: 'active' as const,
  createdAt: new Date(),
};

describe('RegisterService', () => {
  let service: RegisterService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockHash.mockResolvedValue('$argon2id$hashed');
    mockCreateWithEmail.mockResolvedValue(fakeUser);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegisterService,
        { provide: PasswordService, useValue: { hash: mockHash } },
        { provide: UserRepository, useValue: { createWithEmail: mockCreateWithEmail } },
        { provide: EventEmitter2, useValue: { emit: mockEmit } },
      ],
    }).compile();

    service = module.get<RegisterService>(RegisterService);
  });

  it('hashes the password with PasswordService before storing', async () => {
    await service.register(validDto);

    expect(mockHash).toHaveBeenCalledWith('ValidPass1');
    expect(mockCreateWithEmail).toHaveBeenCalledWith(
      expect.objectContaining({ passwordHash: '$argon2id$hashed' }),
    );
  });

  it('never passes the raw password to createWithEmail', async () => {
    await service.register(validDto);

    const [firstCall] = mockCreateWithEmail.mock.calls as [Record<string, unknown>][];
    expect(firstCall?.[0]).not.toHaveProperty('password');
  });

  it('calls userRepository.createWithEmail with correct input', async () => {
    await service.register(validDto);

    expect(mockCreateWithEmail).toHaveBeenCalledWith({
      email: 'user@example.com',
      passwordHash: '$argon2id$hashed',
      firstName: 'John',
      lastName: 'Doe',
      phone: null,
      acceptedPolicy: true,
    });
  });

  it('returns { userId } with the created user id', async () => {
    const result = await service.register(validDto);

    expect(result).toEqual({ userId: 'user-uuid-1' });
  });

  it('emits audit.recorded event with user_id as actor — no PII in event metadata', async () => {
    const context = { requestId: 'req-123', ip: '192.168.1.1' };

    await service.register(validDto, context);

    expect(mockEmit).toHaveBeenCalledWith(
      AUDIT_RECORDED_EVENT,
      expect.objectContaining({
        action: 'auth.register',
        actor: 'user-uuid-1',
        target: { type: 'user', id: 'user-uuid-1' },
        requestId: 'req-123',
        ip: '192.168.1.1',
      }),
    );

    const [emitCall] = mockEmit.mock.calls as [string, Record<string, unknown>][];
    expect(emitCall?.[1]).not.toHaveProperty('metadata');
  });

  it('propagates EmailAlreadyExistsError from repository unchanged', async () => {
    mockCreateWithEmail.mockRejectedValue(new EmailAlreadyExistsError('user@example.com'));

    await expect(service.register(validDto)).rejects.toThrow(EmailAlreadyExistsError);
  });

  it('still emits audit event when no context is provided', async () => {
    await service.register(validDto);

    expect(mockEmit).toHaveBeenCalledWith(
      AUDIT_RECORDED_EVENT,
      expect.objectContaining({
        action: 'auth.register',
        actor: 'user-uuid-1',
      }),
    );
  });
});
