import {
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';

import { type RegisterDto, RegisterSchema } from '../dtos/register.dto';
import { EmailAlreadyExistsError, RegisterService } from '../services/register.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly registerService: RegisterService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body(new ZodValidationPipe(RegisterSchema)) dto: RegisterDto,
    @Req() req: Request & { id?: string },
  ): Promise<{ user_id: string }> {
    try {
      const result = await this.registerService.register(dto, {
        requestId: req.id,
        ip: req.ip,
      });
      return { user_id: result.userId };
    } catch (err) {
      if (err instanceof EmailAlreadyExistsError) {
        throw new ConflictException({
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'Este email ya está registrado',
        });
      }
      throw err;
    }
  }
}
