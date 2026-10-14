import { Module } from '@nestjs/common'
import { AuditModule } from './features/audit/audit.module'
import { CasesModule } from './features/cases/cases.module'
import { DecisionQueueModule } from './features/decision-queue/decision-queue.module'
import { DisputesModule } from './features/disputes/disputes.module'
import { PoliciesModule } from './features/policies/policies.module'
import { RecoveryImportsModule } from './features/recovery-imports/recovery-imports.module'
import { AuthModule } from './features/auth/auth.module'
import { GroupsModule } from './features/groups/groups.module'
import { ScopesModule } from './features/scopes/scopes.module'
import { ServerModule } from './features/server/server.module'
import { ProfilesModule } from './features/profiles/profiles.module'
import { UsersModule } from './features/users/users.module'
import { PlatformModule } from './platform/platform.module'

/**
 * Root module. A business feature adds its module to `imports` (lot r1 added accounts, groups and scopes;
 * lot r2 added the audit journal; lot r3 adds the imports here).
 */
@Module({ imports: [PlatformModule, ServerModule, AuthModule, UsersModule, GroupsModule, ScopesModule, AuditModule, ProfilesModule, CasesModule, PoliciesModule, RecoveryImportsModule, DisputesModule, DecisionQueueModule] })
export class AppModule {}
