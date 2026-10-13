import { Global, Module } from '@nestjs/common'
import { ScopeAccessService } from './scope-access'
import { ScopedRepository } from './scoped-repository'

/** Row-level rule for the tables attached to a scope: inject `ScopedRepository` in a feature service. */
@Global()
@Module({ providers: [ScopeAccessService, ScopedRepository], exports: [ScopeAccessService, ScopedRepository] })
export class ScopeAccessModule {}
