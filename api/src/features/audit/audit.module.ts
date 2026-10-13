import { Module } from '@nestjs/common'
import { AuditController } from './audit.controller'
import { AuditService } from './audit.service'

/** The journal: read routes only. Entries are written by the platform's `AuditInterceptor` for `@Audited` routes. */
@Module({ controllers: [AuditController], providers: [AuditService] })
export class AuditModule {}
