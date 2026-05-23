import { Global, Module } from '@nestjs/common';

import { AuthModule } from '@/modules/auth/auth.module';

import { AdminAuditController } from './controllers/admin-audit.controller';
import { AuditListener } from './listeners/audit.listener';
import { AdminAuditService } from './services/admin-audit.service';
import { AuditService } from './services/audit.service';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [AdminAuditController],
  providers: [AuditService, AuditListener, AdminAuditService],
  exports: [AuditService],
})
export class AuditModule {}
