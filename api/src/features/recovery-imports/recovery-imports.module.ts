import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common'
import { CasesModule } from '../cases/cases.module'
import { DecisionQueueModule } from '../decision-queue/decision-queue.module'
import { ImportsModule } from '../imports/imports.module'
import { PoliciesModule } from '../policies/policies.module'
import { ImportReportService } from './import-report.service'
import { ImportTypeMiddleware } from './import-type.context'
import { LettrageService } from './lettrage.service'
import { RecoveryImportsController } from './recovery-imports.controller'
import { RecoveryImportsService } from './recovery-imports.service'
import { WholeFileImportService } from './whole-file-import.service'

@Module({
  imports: [ImportsModule, CasesModule, DecisionQueueModule, PoliciesModule],
  controllers: [RecoveryImportsController],
  providers: [RecoveryImportsService, WholeFileImportService, ImportReportService, LettrageService],
  // the decisions of the supervisor replay the lettrage after an assignment (rule-recouvrement-queue-effects)
  exports: [LettrageService],
})
export class RecoveryImportsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ImportTypeMiddleware).forRoutes({ path: 'recovery-imports/:type/:importId/confirm', method: RequestMethod.POST })
  }
}
