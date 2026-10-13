import { Module } from '@nestjs/common'
import { ScopesController } from './scopes.controller'
import { ScopesService } from './scopes.service'

@Module({ controllers: [ScopesController], providers: [ScopesService] })
export class ScopesModule {}
