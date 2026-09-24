import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { SalesRecordsGateway } from '@server/modules/agent-core/agent.ports';
import type {
  BaseTableMapping,
  PendingAction,
  SalesRecordResult,
  TenantIntegration,
} from '@server/modules/agent-core/agent.types';
import { FeishuClientFactory } from '@server/modules/feishu/feishu-client.factory';
import {
  assertFeishuSuccess,
  requireFeishuId,
} from '@server/modules/feishu/feishu-api.error';

interface BaseReferenceValue {
  id: string;
}

type BaseCellValue =
  | string
  | number
  | boolean
  | string[]
  | BaseReferenceValue[];

interface BaseRecordReference {
  recordId: string;
  recordUrl?: string;
}

interface BaseWriteResponse {
  code?: number;
  msg?: string;
  data?: {
    record?: {
      record_id?: string;
      record_url?: string;
    };
  };
}

interface SearchCondition {
  field_name: string;
  operator:
    | 'is'
    | 'isNot'
    | 'contains'
    | 'doesNotContain'
    | 'isEmpty'
    | 'isNotEmpty'
    | 'isGreater'
    | 'isGreaterEqual'
    | 'isLess'
    | 'isLessEqual'
    | 'like'
    | 'in';
  value?: string[];
}

@Injectable()
export class FeishuBaseGateway implements SalesRecordsGateway {
  constructor(private readonly clients: FeishuClientFactory) {}

  async upsertCustomer(
    integration: TenantIntegration,
    action: PendingAction,
  ): Promise<SalesRecordResult> {
    const customerName: string = this.requireCustomerName(action);
    const table = integration.base.customers;
    const existing: BaseRecordReference | null =
      await this.findUniqueRecord(integration, table, [
        {
          field_name: table.fields.customerName,
          operator: 'is',
          value: [customerName],
        },
      ]);
    const fields: Record<string, BaseCellValue> = {};
    fields[table.primaryField] = customerName;
    fields[table.fields.customerName] = customerName;
    this.setText(
      fields,
      table.fields.contactName,
      action.payload.draft.contactName,
    );
    this.setText(
      fields,
      table.fields.latestSummary,
      action.payload.draft.summary,
    );
    this.setNumber(
      fields,
      table.fields.lastFollowupAt,
      action.createdAt.getTime(),
    );
    this.setUser(
      fields,
      table.fields.ownerOpenId,
      action.actorOpenId,
    );

    if (existing) {
      return this.updateRecord(
        integration,
        table,
        existing.recordId,
        fields,
        `${action.id}:customer:update`,
      );
    }
    return this.createRecord(
      integration,
      table,
      fields,
      `${action.id}:customer:create`,
    );
  }

  async upsertOpportunity(
    integration: TenantIntegration,
    action: PendingAction,
    customerRecordId: string,
  ): Promise<SalesRecordResult> {
    const customerName: string = this.requireCustomerName(action);
    const opportunityName: string =
      action.payload.draft.opportunityName ?? `${customerName} - 销售机会`;
    const table = integration.base.opportunities;
    const existing: BaseRecordReference | null =
      await this.findUniqueRecord(integration, table, [
        {
          field_name: table.fields.opportunityName,
          operator: 'is',
          value: [opportunityName],
        },
        {
          field_name: table.fields.customerLink,
          operator: 'is',
          value: [customerRecordId],
        },
      ]);
    const fields: Record<string, BaseCellValue> = {};
    fields[table.primaryField] = opportunityName;
    fields[table.fields.opportunityName] = opportunityName;
    fields[table.fields.customerLink] = [customerRecordId];
    this.setNumber(
      fields,
      table.fields.expectedAmount,
      action.payload.draft.expectedAmount,
    );
    this.setText(
      fields,
      table.fields.progress,
      action.payload.draft.progress,
    );
    this.setText(
      fields,
      table.fields.nextAction,
      action.payload.draft.nextAction,
    );
    this.setDate(
      fields,
      table.fields.dueAt,
      action.payload.draft.dueAt,
    );
    this.setUser(
      fields,
      table.fields.ownerOpenId,
      action.actorOpenId,
    );

    if (existing) {
      return this.updateRecord(
        integration,
        table,
        existing.recordId,
        fields,
        `${action.id}:opportunity:update`,
      );
    }
    return this.createRecord(
      integration,
      table,
      fields,
      `${action.id}:opportunity:create`,
    );
  }

  async createFollowup(
    integration: TenantIntegration,
    action: PendingAction,
    customerRecordId: string,
    opportunityRecordId: string,
  ): Promise<SalesRecordResult> {
    const table = integration.base.followups;
    const existing: BaseRecordReference | null =
      await this.findUniqueRecord(integration, table, [
        {
          field_name: table.fields.sourceMessageId,
          operator: 'is',
          value: [action.payload.sourceMessageId],
        },
      ]);
    if (existing) {
      return {
        recordId: existing.recordId,
        recordUrl: existing.recordUrl,
      };
    }

    const fields: Record<string, BaseCellValue> = this.buildFollowupFields(
      integration.base.followups,
      action,
      customerRecordId,
      opportunityRecordId,
    );

    return this.createRecord(
      integration,
      table,
      fields,
      `${action.id}:followup:create`,
    );
  }

  async updateFollowup(
    integration: TenantIntegration,
    action: PendingAction,
    customerRecordId: string,
    opportunityRecordId: string,
    followupRecordId: string,
  ): Promise<SalesRecordResult> {
    const fields: Record<string, BaseCellValue> = this.buildFollowupFields(
      integration.base.followups,
      action,
      customerRecordId,
      opportunityRecordId,
    );
    return this.updateRecord(
      integration,
      integration.base.followups,
      followupRecordId,
      fields,
      `${action.id}:followup:update`,
    );
  }

  private buildFollowupFields(
    table: TenantIntegration['base']['followups'],
    action: PendingAction,
    customerRecordId: string,
    opportunityRecordId: string,
  ): Record<string, BaseCellValue> {
    const customerName: string = this.requireCustomerName(action);
    const fields: Record<string, BaseCellValue> = {};
    fields[table.primaryField] =
      `${customerName} · ${action.createdAt.toISOString().slice(0, 10)}`;
    fields[table.fields.sourceMessageId] = action.payload.sourceMessageId;
    fields[table.fields.customerLink] = [customerRecordId];
    fields[table.fields.opportunityLink] = [opportunityRecordId];
    fields[table.fields.rawText] = action.payload.rawText;
    fields[table.fields.summary] =
      action.payload.generatedBody ?? action.payload.draft.summary;
    this.setList(fields, table.fields.customerNeeds,
      action.payload.draft.customerNeeds);
    this.setList(fields, table.fields.objections,
      action.payload.draft.objections);
    this.setList(fields, table.fields.risks, action.payload.draft.risks);
    this.setText(fields, table.fields.nextAction,
      action.payload.draft.nextAction);
    this.setDate(fields, table.fields.dueAt, action.payload.draft.dueAt);
    this.setUser(fields, table.fields.ownerOpenId, action.actorOpenId);
    return fields;
  }

  private async findUniqueRecord<TFields>(
    integration: TenantIntegration,
    table: BaseTableMapping<TFields>,
    conditions: SearchCondition[],
  ): Promise<BaseRecordReference | null> {
    const client = this.clients.getClient(integration);
    const response = await client.bitable.appTableRecord.search(
      {
        path: {
          app_token: integration.base.appToken,
          table_id: table.tableId,
        },
        params: {
          page_size: 2,
          user_id_type: 'open_id',
        },
        data: {
          filter: {
            conjunction: 'and',
            conditions,
          },
        },
      },
      this.clients.getRequestOptions(integration),
    );
    assertFeishuSuccess(response.code, response.msg, 'search Base record');
    const items = response.data?.items ?? [];
    if (items.length > 1) {
      throw new Error('Base business key is ambiguous; multiple records found');
    }
    const item = items[0];
    if (!item) {
      return null;
    }
    return {
      recordId: requireFeishuId(item.record_id, 'search Base record'),
      recordUrl: item.record_url,
    };
  }

  private async createRecord<TFields>(
    integration: TenantIntegration,
    table: BaseTableMapping<TFields>,
    fields: Record<string, BaseCellValue>,
    idempotencyKey: string,
  ): Promise<SalesRecordResult> {
    const client = this.clients.getClient(integration);
    const response: BaseWriteResponse =
      await client.request<BaseWriteResponse>(
        {
          method: 'POST',
          url: this.recordCollectionUrl(integration, table.tableId),
          params: {
            user_id_type: 'open_id',
            client_token: this.clientToken(idempotencyKey),
          },
          data: {
            fields,
          },
        },
        this.clients.getRequestOptions(integration),
      );
    assertFeishuSuccess(response.code, response.msg, 'create Base record');
    return {
      recordId: requireFeishuId(
        response.data?.record?.record_id,
        'create Base record',
      ),
      recordUrl: response.data?.record?.record_url,
    };
  }

  private async updateRecord<TFields>(
    integration: TenantIntegration,
    table: BaseTableMapping<TFields>,
    recordId: string,
    fields: Record<string, BaseCellValue>,
    idempotencyKey: string,
  ): Promise<SalesRecordResult> {
    const client = this.clients.getClient(integration);
    const response: BaseWriteResponse =
      await client.request<BaseWriteResponse>(
        {
          method: 'PUT',
          url: `${this.recordCollectionUrl(integration, table.tableId)}/` +
            encodeURIComponent(recordId),
          params: {
            user_id_type: 'open_id',
            client_token: this.clientToken(idempotencyKey),
          },
          data: {
            fields,
          },
        },
        this.clients.getRequestOptions(integration),
      );
    assertFeishuSuccess(response.code, response.msg, 'update Base record');
    return {
      recordId: requireFeishuId(
        response.data?.record?.record_id,
        'update Base record',
      ),
      recordUrl: response.data?.record?.record_url,
    };
  }

  private requireCustomerName(action: PendingAction): string {
    const customerName: string | null = action.payload.draft.customerName;
    if (!customerName) {
      throw new Error('Customer name is required before Base writes');
    }
    return customerName;
  }

  private setText(
    fields: Record<string, BaseCellValue>,
    fieldName: string | undefined,
    value: string | null,
  ): void {
    if (fieldName && value) {
      fields[fieldName] = value;
    }
  }

  private setNumber(
    fields: Record<string, BaseCellValue>,
    fieldName: string | undefined,
    value: number | null,
  ): void {
    if (fieldName && value !== null) {
      fields[fieldName] = value;
    }
  }

  private setDate(
    fields: Record<string, BaseCellValue>,
    fieldName: string | undefined,
    value: string | null,
  ): void {
    if (!fieldName || !value) {
      return;
    }
    const timestamp: number = Date.parse(value);
    if (Number.isNaN(timestamp)) {
      throw new Error(`Invalid date for Base field ${fieldName}`);
    }
    fields[fieldName] = timestamp;
  }

  private setUser(
    fields: Record<string, BaseCellValue>,
    fieldName: string | undefined,
    openId: string,
  ): void {
    if (fieldName) {
      fields[fieldName] = [{ id: openId }];
    }
  }

  private setList(
    fields: Record<string, BaseCellValue>,
    fieldName: string | undefined,
    values: string[],
  ): void {
    if (fieldName && values.length > 0) {
      fields[fieldName] = values.join('；');
    }
  }

  private clientToken(value: string): string {
    const bytes: Buffer = createHash('sha256').update(value).digest().subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex: string = bytes.toString('hex');
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join('-');
  }

  private recordCollectionUrl(
    integration: TenantIntegration,
    tableId: string,
  ): string {
    const appToken: string = encodeURIComponent(integration.base.appToken);
    const encodedTableId: string = encodeURIComponent(tableId);
    return `/open-apis/bitable/v1/apps/${appToken}/tables/` +
      `${encodedTableId}/records`;
  }
}
