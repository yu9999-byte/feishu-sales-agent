import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  CONTROL_STORE,
  type ControlStore,
} from './agent.ports';
import type {
  IncomingTaskUpdateEvent,
  TaskEventIngestionOutcome,
  TenantIntegration,
} from './agent.types';

@Injectable()
export class TaskEventIngestionService {
  private readonly logger: Logger = new Logger(TaskEventIngestionService.name);

  constructor(
    @Inject(CONTROL_STORE)
    private readonly store: ControlStore,
  ) {}

  async ingest(
    event: IncomingTaskUpdateEvent,
  ): Promise<TaskEventIngestionOutcome> {
    const integration: TenantIntegration | null =
      await this.store.resolveTenant(event.feishuTenantKey);
    if (!integration || integration.status !== 'active') {
      this.logger.warn(
        `Task event ignored for unavailable tenant: tenant=${this.hashValue(
          event.feishuTenantKey,
        )} event=${this.hashValue(event.eventId)}`,
      );
      return 'ignored_unknown_tenant';
    }

    const inserted: boolean = await this.store.recordTaskEventReceipt({
      tenantId: integration.tenantId,
      eventId: event.eventId,
      taskGuid: event.taskGuid,
      eventTypes: event.eventTypes,
      occurredAt: event.occurredAt,
      receivedAt: event.receivedAt,
      receiptStatus: 'received',
      payloadHash: this.payloadHash(event),
    });
    const outcome: TaskEventIngestionOutcome = inserted
      ? 'recorded'
      : 'duplicate';
    this.logger.debug(
      `Task event ${outcome}: tenant=${this.hashValue(
        event.feishuTenantKey,
      )} event=${this.hashValue(event.eventId)} task=${this.hashValue(
        event.taskGuid,
      )}`,
    );
    return outcome;
  }

  private payloadHash(event: IncomingTaskUpdateEvent): string {
    return createHash('sha256').update([
      event.feishuTenantKey,
      event.eventId,
      event.taskGuid,
      event.eventTypes.join('\u0000'),
      event.occurredAt.toISOString(),
    ].join('\u0000'), 'utf8').digest('hex');
  }

  private hashValue(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
  }
}
