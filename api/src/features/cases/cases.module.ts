import { Module } from '@nestjs/common'
import { CaseStateService } from './case-state.service'
import { CasesController } from './cases.controller'
import { CasesService } from './cases.service'
import { ClockService } from './clock.service'

@Module({
  controllers: [CasesController],
  providers: [CasesService, CaseStateService, ClockService],
  exports: [CaseStateService, ClockService],
})
export class CasesModule {}
