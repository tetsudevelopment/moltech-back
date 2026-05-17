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

import { type LoginDto, LoginSchema } from '../dtos/login.dto';
import { type RegisterDto, RegisterSchema } from '../dtos/register.dto';
import { LoginService } from '../services/login.service';
import { EmailAlreadyExistsError, RegisterService } from '../services/register.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly registerService: RegisterService,
    private readonly loginService: LoginService,
  ) {}

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

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) dto: LoginDto,
    @Req() req: Request & { id?: string },
  ): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user: {
      id: string;
      email: string | null;
      nombres: string;
      apellidos: string;
      estado: string;
    };
  }> {
    const result = await this.loginService.login(dto, {
      requestId: req.id,
      ip: req.ip,
    });
    return {
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      expires_in: 900,
      user: {
        id: result.user.id,
        email: result.user.email,
        nombres: result.user.nombres,
        apellidos: result.user.apellidos,
        estado: result.user.estado,
      },
    };
  }
}
