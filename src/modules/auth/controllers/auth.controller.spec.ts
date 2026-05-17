import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ZodError } from 'zod';

import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { RegisterSchema } from '@/modules/auth/dtos/register.dto';

import { AuthController } from './auth.controller';
import { EmailAlreadyExistsError, RegisterService } from '../services/register.service';

const mockRegister = jest.fn();

const validBody = {
  email: 'user@example.com',
  password: 'ValidPass1',
  nombres: 'John',
  apellidos: 'Doe',
  acepta_politica: true,
};

const fakeRequest = { id: 'req-abc', ip: '127.0.0.1' } as never;

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRegister.mockResolvedValue({ userId: 'new-user-uuid' });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: RegisterService, useValue: { register: mockRegister } }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('POST /auth/register', () => {
    it('calls RegisterService.register with parsed DTO and request context', async () => {
      const dto = RegisterSchema.parse(validBody);

      await controller.register(dto, fakeRequest);

      expect(mockRegister).toHaveBeenCalledWith(dto, { requestId: 'req-abc', ip: '127.0.0.1' });
    });

    it('returns 201 with { user_id } on success', async () => {
      const dto = RegisterSchema.parse(validBody);

      const result = await controller.register(dto, fakeRequest);

      expect(result).toEqual({ user_id: 'new-user-uuid' });
    });

    it('throws ConflictException when EmailAlreadyExistsError is raised', async () => {
      mockRegister.mockRejectedValue(new EmailAlreadyExistsError('user@example.com'));
      const dto = RegisterSchema.parse(validBody);

      await expect(controller.register(dto, fakeRequest)).rejects.toThrow(ConflictException);
    });

    it('DTO validation fails → ZodValidationPipe throws ZodError', () => {
      const pipe = new ZodValidationPipe(RegisterSchema);

      expect(() =>
        pipe.transform({ email: 'not-an-email', password: 'short', nombres: '', apellidos: '' }),
      ).toThrow(ZodError);
    });

    it('rethrows unexpected errors that are not EmailAlreadyExistsError', async () => {
      const unexpectedError = new Error('Unexpected DB failure');
      mockRegister.mockRejectedValue(unexpectedError);
      const dto = RegisterSchema.parse(validBody);

      await expect(controller.register(dto, fakeRequest)).rejects.toThrow('Unexpected DB failure');
    });
  });
});
