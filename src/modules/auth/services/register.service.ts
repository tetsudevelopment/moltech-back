import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  AUDIT_RECORDED_EVENT,
  type AuditRecordedEvent,
} from '@/modules/audit/events/audit-recorded.event';

import { PasswordService } from './password.service';
import { type RegisterDto } from '../dtos/register.dto';
import {
  type CreateEmailUserInput,
  EmailAlreadyExistsError,
  UserRepository,
} from '../repositories/user.repository';

export { EmailAlreadyExistsError };

export interface RegisterContext {
  requestId?: string | undefined;
  ip?: string | undefined;
}

export interface RegisterResult {
  userId: string;
}

@Injectable()
export class RegisterService {
  constructor(
    private readonly users: UserRepository,
    private readonly passwords: PasswordService,
    private readonly emitter: EventEmitter2,
  ) {}

  async register(dto: RegisterDto, context: RegisterContext = {}): Promise<RegisterResult> {
    const passwordHash = await this.passwords.hash(dto.password);

    const input: CreateEmailUserInput = {
      email: dto.email,
      passwordHash,
      nombres: dto.nombres,
      apellidos: dto.apellidos,
      telefono: dto.telefono ?? null,
      aceptaPolitica: dto.acepta_politica,
    };

    const user = await this.users.createWithEmail(input);

    const auditEvent: AuditRecordedEvent = {
      action: 'auth.register',
      actor: user.id,
      target: { type: 'user', id: user.id },
      timestamp: new Date().toISOString(),
      ...(context.requestId !== undefined ? { requestId: context.requestId } : {}),
      ...(context.ip !== undefined ? { ip: context.ip } : {}),
    };
    this.emitter.emit(AUDIT_RECORDED_EVENT, auditEvent);

    return { userId: user.id };
  }
}
