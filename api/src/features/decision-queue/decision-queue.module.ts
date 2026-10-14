import { Module } from '@nestjs/common'
import { DecisionQueueController } from './decision-queue.controller'
import { QueueReadService } from './queue-read.service'
import { QueueService } from './queue.service'

/** The writer of the queue (imports) and its read routes; the decision route comes with the lot of the day. */
@Module({ controllers: [DecisionQueueController], providers: [QueueService, QueueReadService], exports: [QueueService, QueueReadService] })
export class DecisionQueueModule {}
