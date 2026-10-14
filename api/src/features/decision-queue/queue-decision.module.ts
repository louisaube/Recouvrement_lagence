import { Module } from '@nestjs/common'
import { BrainModule } from '../brain/brain.module'
import { CasesModule } from '../cases/cases.module'
import { RecoveryImportsModule } from '../recovery-imports/recovery-imports.module'
import { DecisionQueueModule } from './decision-queue.module'
import { QueueDecisionController } from './queue-decision.controller'
import { QueueDecisionService } from './queue-decision.service'

/** The decision route of the queue; it lives apart from the module of the queue because the lettrage it replays belongs to the imports, which already import the queue. */
@Module({
  imports: [BrainModule, CasesModule, DecisionQueueModule, RecoveryImportsModule],
  controllers: [QueueDecisionController],
  providers: [QueueDecisionService],
})
export class QueueDecisionModule {}
