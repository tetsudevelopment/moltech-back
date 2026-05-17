import { SetMetadata } from '@nestjs/common';

export const SKIP_ENVELOPE_KEY = 'moltech:skip-envelope';
export const SkipEnvelope = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_ENVELOPE_KEY, true);
