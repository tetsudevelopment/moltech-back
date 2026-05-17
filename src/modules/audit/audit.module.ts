import { Global, Module } from '@nestjs/common';

import { AuditListener } from './listeners/audit.listener';
import { AuditService } from './services/audit.service';

@Global()
@Module({
  providers: [AuditService, AuditListener],
  exports: [AuditService],
})
export class AuditModule {}
