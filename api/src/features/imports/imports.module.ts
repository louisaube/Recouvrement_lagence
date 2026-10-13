import { Module } from '@nestjs/common'
import { ImportsService } from './imports.service'

/** The reusable import mechanism: a feature imports this module and calls `ImportsService` from its routes. */
@Module({ providers: [ImportsService], exports: [ImportsService] })
export class ImportsModule {}
