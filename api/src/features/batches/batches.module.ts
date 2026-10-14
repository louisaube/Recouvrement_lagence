import { Module } from '@nestjs/common'
import { BrainModule } from '../brain/brain.module'
import { CasesModule } from '../cases/cases.module'
import { DecisionQueueModule } from '../decision-queue/decision-queue.module'
import { PoliciesModule } from '../policies/policies.module'
import { BatchPreparationService } from './batch-preparation.service'
import { BatchesController } from './batches.controller'
import { BatchesService } from './batches.service'

/** The daily batch: preparation by the supervisor, checks, orders, release of a blocked batch. */
@Module({
  imports: [BrainModule, CasesModule, DecisionQueueModule, PoliciesModule],
  controllers: [BatchesController],
  providers: [BatchesService, BatchPreparationService],
})
export class BatchesModule {}
