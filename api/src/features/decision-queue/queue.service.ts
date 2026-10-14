import { Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import type { ImportExecutor } from '../imports/imports.types'
import { textArray } from '../recovery-common/sql'
import type { QueueType } from './decision-queue.tables'

export interface NewQueueItem {
  type: QueueType
  caseId: string | null
  /** Identifies the object the item is about (1 to 100 characters): one open item per (type, object). */
  objectKey: string
  summary: string
  details?: unknown[]
}

/**
 * The only writer of the queue of the supervisor outside of the decisions themselves
 * (rule-recouvrement-queue-single-open, rule-recouvrement-queue-auto-close). The routes that read and decide the items
 * come with the lot of the day; this lot opens the items its imports call for and closes the ones that no longer apply.
 */
@Injectable()
export class QueueService {
  /** Opens the items that are not already open; returns how many were opened. */
  async openMany(tx: ImportExecutor, items: NewQueueItem[]): Promise<number> {
    let opened = 0
    for (let i = 0; i < items.length; i += 500) {
      const chunk = items.slice(i, i + 500)
      const result = await tx.execute(sql`
        insert into base.queue_items (type, status, case_id, object_key, summary, details)
        values ${sql.join(
          chunk.map(
            (item) =>
              sql`(${item.type}, 'open', ${item.caseId}::uuid, ${item.objectKey}, ${item.summary.slice(0, 300)}, ${JSON.stringify(item.details ?? [])}::jsonb)`,
          ),
          sql`, `,
        )}
        on conflict (type, object_key) where status = 'open' do nothing
        returning id
      `)
      opened += result.rows.length
    }
    return opened
  }

  /**
   * Closes, without decision (`auto_closed`, no author), the open items of a type whose object is no longer in
   * `liveKeys`; returns how many were closed.
   */
  async autoCloseMissing(tx: ImportExecutor, type: QueueType, liveKeys: string[]): Promise<number> {
    const result = await tx.execute(sql`
      update base.queue_items
      set status = 'decided', decided_at = now(), decision_code = 'auto_closed', decided_by = null
      where type = ${type} and status = 'open'
        and not (object_key = any(${textArray(liveKeys)}))
      returning id
    `)
    return result.rows.length
  }
}
