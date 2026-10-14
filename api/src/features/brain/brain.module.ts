import { Module } from '@nestjs/common'
import { CasesModule } from '../cases/cases.module'
import { DecisionQueueModule } from '../decision-queue/decision-queue.module'
import { PoliciesModule } from '../policies/policies.module'
import { BrainService } from './brain.service'
import { DecisionJournal } from './decision-journal.service'

/** The brain: evaluation of the cases and journal of its decisions; no route (the journal is read by `cases`). */
@Module({
  imports: [CasesModule, DecisionQueueModule, PoliciesModule],
  providers: [BrainService, DecisionJournal],
  exports: [BrainService, DecisionJournal],
})
export class BrainModule {}
