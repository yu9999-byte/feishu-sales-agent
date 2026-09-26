import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { SalesRecordsGateway } from '@server/modules/agent-core/agent.ports';
import type {
  BaseTableMapping,
  PendingAction,
  SalesContextBaseResult,
  SalesContextHints,
  SalesRecordResult,
  OpportunityLifecycleStatus,
  OpportunityStatusValueMapping,
  StaleOpportunityFollowupPage,
  StaleOpportunityPage,
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

interface BaseContextRecord {
  record_id?: string;
  record_url?: string;
  last_modified_time?: number;
  fields: Record<string, unknown>;
}

interface BaseContextSearchResponse {
  code?: number;
  msg?: string;
  data?: {
    items?: BaseContextRecord[];
    has_more?: boolean;
    page_token?: string;
  };
}

const STALE_FOLLOWUP_PAGE_SIZE = 500;
const STALE_OPPORTUNITY_PAGE_SIZE = 500;

@Injectable()
export class FeishuBaseGateway implements SalesRecordsGateway {
  constructor(private readonly clients: FeishuClientFactory) {}

  async readSalesContext(
    integration: TenantIntegration,
    actorOpenId: string,
    hints: SalesContextHints,
  ): Promise<SalesContextBaseResult> {
    const empty: SalesContextBaseResult = {
      customers: [],
      opportunities: [],
      followups: [],
      warnings: [],
    };
    const customerTable = integration.base.customers;
    const opportunityTable = integration.base.opportunities;
    const followupTable = integration.base.followups;
    if (
      !customerTable.fields.ownerOpenId ||
      !opportunityTable.fields.ownerOpenId ||
      !followupTable.fields.ownerOpenId
    ) {
      return {
        ...empty,
        warnings: ['owner_scope_mapping_not_configured'],
      };
    }

    const customerItems: BaseContextRecord[] = await this.searchContextRecords(
      integration,
      customerTable,
      [
        {
          field_name: customerTable.fields.customerName,
          operator: 'is',
          value: [hints.customerName ?? ''],
        },
        {
          field_name: customerTable.fields.ownerOpenId,
          operator: 'is',
          value: [actorOpenId],
        },
      ],
      [
        customerTable.fields.customerName,
        customerTable.fields.contactName,
        customerTable.fields.latestSummary,
        customerTable.fields.lastFollowupAt,
      ],
      10,
    );
    const customers = customerItems.flatMap((item) => {
      const recordId: string | undefined = item.record_id;
      const name: string | null = this.readText(
        item.fields,
        customerTable.fields.customerName,
      );
      if (!recordId || !name) return [];
      return [{
        recordId,
        name,
        contactName: this.readText(
          item.fields,
          customerTable.fields.contactName,
        ),
        latestSummary: this.readText(
          item.fields,
          customerTable.fields.latestSummary,
        ),
        lastFollowupAt: this.readDate(
          item.fields,
          customerTable.fields.lastFollowupAt,
        ),
        sourceVersion: this.sourceVersion(item.last_modified_time),
        recordUrl: item.record_url ?? null,
      }];
    });
    if (customers.length !== 1) {
      return { ...empty, customers };
    }

    const customer = customers[0];
    const opportunityScopeConditions: SearchCondition[] = [
      {
        field_name: opportunityTable.fields.customerLink,
        operator: 'is',
        value: [customer.recordId],
      },
      {
        field_name: opportunityTable.fields.ownerOpenId,
        operator: 'is',
        value: [actorOpenId],
      },
    ];
    const opportunityConditions: SearchCondition[] = [
      ...opportunityScopeConditions,
    ];
    if (hints.opportunityName) {
      opportunityConditions.push({
        field_name: opportunityTable.fields.opportunityName,
        operator: 'is',
        value: [hints.opportunityName],
      });
    }
    const opportunityFieldNames: Array<string | undefined> = [
      opportunityTable.fields.opportunityName,
      opportunityTable.fields.progress,
      opportunityTable.fields.expectedAmount,
      opportunityTable.fields.nextAction,
      opportunityTable.fields.dueAt,
      opportunityTable.fields.customerLink,
    ];
    let opportunityItems: BaseContextRecord[] =
      await this.searchContextRecords(
        integration,
        opportunityTable,
        opportunityConditions,
        opportunityFieldNames,
        20,
      );
    if (hints.opportunityName && opportunityItems.length === 0) {
      opportunityItems = await this.searchContextRecords(
        integration,
        opportunityTable,
        opportunityScopeConditions,
        opportunityFieldNames,
        20,
      );
    }
    const opportunities = opportunityItems.flatMap((item) => {
      const recordId: string | undefined = item.record_id;
      const name: string | null = this.readText(
        item.fields,
        opportunityTable.fields.opportunityName,
      );
      if (!recordId || !name) return [];
      return [{
        recordId,
        customerRecordId: customer.recordId,
        name,
        progress: this.readText(
          item.fields,
          opportunityTable.fields.progress,
        ),
        expectedAmount: this.readNumber(
          item.fields,
          opportunityTable.fields.expectedAmount,
        ),
        nextAction: this.readText(
          item.fields,
          opportunityTable.fields.nextAction,
        ),
        dueAt: this.readDate(item.fields, opportunityTable.fields.dueAt),
        sourceVersion: this.sourceVersion(item.last_modified_time),
        recordUrl: item.record_url ?? null,
      }];
    });

    const followupItems: BaseContextRecord[] =
      await this.searchContextRecords(
        integration,
        followupTable,
        [
          {
            field_name: followupTable.fields.customerLink,
            operator: 'is',
            value: [customer.recordId],
          },
          {
            field_name: followupTable.fields.ownerOpenId,
            operator: 'is',
            value: [actorOpenId],
          },
        ],
        [
          followupTable.fields.summary,
          followupTable.fields.nextAction,
          followupTable.fields.dueAt,
          followupTable.fields.communicationAt,
          followupTable.fields.opportunityLink,
        ],
        100,
      );
    const recentFollowups = [...followupItems]
      .sort((left, right) =>
        (right.last_modified_time ?? 0) - (left.last_modified_time ?? 0),
      )
      .slice(0, 5);
    const followups = recentFollowups.flatMap((item) => {
      const recordId: string | undefined = item.record_id;
      const summary: string | null = this.readText(
        item.fields,
        followupTable.fields.summary,
      );
      if (!recordId || !summary) return [];
      return [{
        recordId,
        summary,
        opportunityRecordId: this.readLinkedRecordId(
          item.fields,
          followupTable.fields.opportunityLink,
        ),
        nextAction: this.readText(
          item.fields,
          followupTable.fields.nextAction,
        ),
        dueAt: this.readDate(item.fields, followupTable.fields.dueAt),
        communicationAt: this.readDate(
          item.fields,
          followupTable.fields.communicationAt,
        ),
        sourceVersion: this.sourceVersion(item.last_modified_time),
        recordUrl: item.record_url ?? null,
      }];
    });

    return { customers, opportunities, followups, warnings: [] };
  }

  async readStaleOpportunityFollowupPage(
    integration: TenantIntegration,
    actorOpenId: string,
    pageToken?: string,
  ): Promise<StaleOpportunityFollowupPage> {
    const table = integration.base.followups;
    if (!table.fields.ownerOpenId) {
      return {
        items: [],
        nextPageToken: null,
        warning: 'owner_scope_mapping_not_configured',
      };
    }
    if (!table.fields.opportunityLink) {
      return {
        items: [],
        nextPageToken: null,
        warning: 'stale_followup_opportunity_mapping_not_configured',
      };
    }
    if (!table.fields.communicationAt) {
      return {
        items: [],
        nextPageToken: null,
        warning: 'stale_followup_communication_time_mapping_not_configured',
      };
    }

    const client = this.clients.getClient(integration);
    const params: {
      page_size: number;
      user_id_type: 'open_id';
      page_token?: string;
    } = {
      page_size: STALE_FOLLOWUP_PAGE_SIZE,
      user_id_type: 'open_id',
    };
    const normalizedPageToken: string = pageToken?.trim() ?? '';
    if (normalizedPageToken) {
      params.page_token = normalizedPageToken;
    }

    const response: BaseContextSearchResponse =
      await client.bitable.appTableRecord.search(
        {
          path: {
            app_token: integration.base.appToken,
            table_id: table.tableId,
          },
          params,
          data: {
            field_names: [
              table.fields.opportunityLink,
              table.fields.communicationAt,
            ],
            filter: {
              conjunction: 'and',
              conditions: [
                {
                  field_name: table.fields.ownerOpenId,
                  operator: 'is',
                  value: [actorOpenId],
                },
              ],
            },
          },
        },
        this.clients.getRequestOptions(integration),
      );
    assertFeishuSuccess(response.code, response.msg, 'read stale followups');

    const items: BaseContextRecord[] = response.data?.items ?? [];
    const mappedItems: StaleOpportunityFollowupPage['items'] = items.flatMap(
      (item: BaseContextRecord) => {
        const recordId: string | undefined = item.record_id;
        if (!recordId) return [];
        return [{
          recordId,
          opportunityRecordId: this.readLinkedRecordId(
            item.fields,
            table.fields.opportunityLink,
          ),
          communicationAt: this.readDate(
            item.fields,
            table.fields.communicationAt,
          ),
          sourceVersion: this.sourceVersion(item.last_modified_time),
        }];
      },
    );
    const hasMore: boolean = response.data?.has_more === true;
    const nextPageToken: string = response.data?.page_token?.trim() ?? '';
    if (hasMore && !nextPageToken) {
      return {
        items: mappedItems,
        nextPageToken: null,
        warning: 'stale_followup_pagination_incomplete',
      };
    }

    return {
      items: mappedItems,
      nextPageToken: nextPageToken || null,
    };
  }

  async readStaleOpportunityPage(
    integration: TenantIntegration,
    actorOpenId: string,
    pageToken?: string,
  ): Promise<StaleOpportunityPage> {
    const table = integration.base.opportunities;
    if (!table.fields.ownerOpenId) {
      return {
        items: [],
        nextPageToken: null,
        warning: 'owner_scope_mapping_not_configured',
      };
    }
    if (!table.fields.status) {
      return {
        items: [],
        nextPageToken: null,
        warning: 'opportunity_status_mapping_not_configured',
      };
    }
    if (!table.statusValues?.active.length) {
      return {
        items: [],
        nextPageToken: null,
        warning: 'opportunity_status_values_not_configured',
      };
    }
    if (!actorOpenId.trim()) {
      return {
        items: [],
        nextPageToken: null,
        warning: 'owner_scope_not_provided',
      };
    }

    const client = this.clients.getClient(integration);
    const params: {
      page_size: number;
      user_id_type: 'open_id';
      page_token?: string;
    } = {
      page_size: STALE_OPPORTUNITY_PAGE_SIZE,
      user_id_type: 'open_id',
    };
    const normalizedPageToken: string = pageToken?.trim() ?? '';
    if (normalizedPageToken) {
      params.page_token = normalizedPageToken;
    }

    const response: BaseContextSearchResponse =
      await client.bitable.appTableRecord.search(
        {
          path: {
            app_token: integration.base.appToken,
            table_id: table.tableId,
          },
          params,
          data: {
            field_names: [
              table.fields.opportunityName,
              table.fields.status,
            ],
            filter: {
              conjunction: 'and',
              conditions: [
                {
                  field_name: table.fields.ownerOpenId,
                  operator: 'is',
                  value: [actorOpenId],
                },
              ],
            },
          },
        },
        this.clients.getRequestOptions(integration),
      );
    assertFeishuSuccess(response.code, response.msg, 'read stale opportunities');

    const items: BaseContextRecord[] = response.data?.items ?? [];
    const mappedItems: StaleOpportunityPage['items'] = items.flatMap(
      (item: BaseContextRecord) => {
        const recordId: string | undefined = item.record_id;
        const name: string | null = this.readText(
          item.fields,
          table.fields.opportunityName,
        );
        if (!recordId || !name) return [];
        const rawStatus: string | null = this.readText(
          item.fields,
          table.fields.status,
        );
        return [{
          recordId,
          name,
          status: this.mapOpportunityStatus(rawStatus, table.statusValues),
          ownerOpenId: actorOpenId,
          sourceVersion: this.sourceVersion(item.last_modified_time),
        }];
      },
    );
    const hasMore: boolean = response.data?.has_more === true;
    const nextPageToken: string = response.data?.page_token?.trim() ?? '';
    if (hasMore && !nextPageToken) {
      return {
        items: mappedItems,
        nextPageToken: null,
        warning: 'stale_opportunity_pagination_incomplete',
      };
    }

    return {
      items: mappedItems,
      nextPageToken: nextPageToken || null,
    };
  }

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
    this.setDate(
      fields,
      table.fields.communicationAt,
      action.payload.draft.communicationAt ?? null,
    );
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

  private async searchContextRecords<TFields>(
    integration: TenantIntegration,
    table: BaseTableMapping<TFields>,
    conditions: SearchCondition[],
    fieldNames: Array<string | undefined>,
    pageSize: number,
  ): Promise<BaseContextRecord[]> {
    const client = this.clients.getClient(integration);
    const response: BaseContextSearchResponse =
      await client.bitable.appTableRecord.search(
        {
          path: {
            app_token: integration.base.appToken,
            table_id: table.tableId,
          },
          params: {
            page_size: pageSize,
            user_id_type: 'open_id',
          },
          data: {
            field_names: fieldNames.filter(
              (name: string | undefined): name is string => name !== undefined,
            ),
            filter: {
              conjunction: 'and',
              conditions,
            },
          },
        },
        this.clients.getRequestOptions(integration),
      );
    assertFeishuSuccess(response.code, response.msg, 'read Base context');
    return response.data?.items ?? [];
  }

  private readText(
    fields: Record<string, unknown>,
    fieldName: string | undefined,
  ): string | null {
    if (!fieldName) return null;
    const value: unknown = fields[fieldName];
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (Array.isArray(value)) {
      const textSegments: string[] = [];
      const displayValues: string[] = [];
      value.forEach((item: unknown): void => {
        if (typeof item === 'string') {
          displayValues.push(item);
          return;
        }
        if (typeof item !== 'object' || item === null) return;
        const text: unknown = 'text' in item ? item.text : undefined;
        if (typeof text === 'string') {
          textSegments.push(text);
          return;
        }
        const name: unknown = 'name' in item ? item.name : undefined;
        if (typeof name === 'string') {
          displayValues.push(name);
        }
      });
      if (textSegments.length > 0 && displayValues.length === 0) {
        return textSegments.join('');
      }
      const values: string[] = [...textSegments, ...displayValues];
      return values.length > 0 ? values.join('、') : null;
    }
    if (typeof value === 'object' && value !== null && 'text' in value) {
      const text: unknown = value.text;
      return typeof text === 'string' ? text : null;
    }
    return null;
  }

  private mapOpportunityStatus(
    rawStatus: string | null,
    values: OpportunityStatusValueMapping,
  ): OpportunityLifecycleStatus {
    const normalized: string = this.normalizeStatusValue(rawStatus);
    if (!normalized) return 'unknown';
    const matches = (candidates: string[] | undefined): boolean =>
      candidates?.some(
        (candidate: string): boolean =>
          this.normalizeStatusValue(candidate) === normalized,
      ) ?? false;
    if (matches(values.active)) return 'active';
    if (matches(values.won)) return 'won';
    if (matches(values.lost)) return 'lost';
    if (matches(values.closed)) return 'closed';
    return 'unknown';
  }

  private normalizeStatusValue(value: string | null): string {
    return value?.normalize('NFKC').trim().toLocaleLowerCase() ?? '';
  }

  private readLinkedRecordId(
    fields: Record<string, unknown>,
    fieldName: string | undefined,
  ): string | null {
    if (!fieldName || !Array.isArray(fields[fieldName])) return null;
    const items: unknown[] = fields[fieldName];
    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue;
      const recordId: unknown =
        'record_id' in item
          ? item.record_id
          : 'link_record_id' in item
            ? item.link_record_id
            : undefined;
      if (typeof recordId === 'string' && recordId.length > 0) {
        return recordId;
      }
      const recordIds: unknown =
        'link_record_ids' in item ? item.link_record_ids : undefined;
      if (
        Array.isArray(recordIds) &&
        typeof recordIds[0] === 'string' &&
        recordIds[0].length > 0
      ) {
        return recordIds[0];
      }
    }
    return null;
  }

  private readNumber(
    fields: Record<string, unknown>,
    fieldName: string | undefined,
  ): number | null {
    if (!fieldName) return null;
    const value: unknown = fields[fieldName];
    const number: number = typeof value === 'number'
      ? value
      : typeof value === 'string' ? Number(value) : Number.NaN;
    return Number.isFinite(number) ? number : null;
  }

  private readDate(
    fields: Record<string, unknown>,
    fieldName: string | undefined,
  ): string | null {
    if (!fieldName) return null;
    const value: unknown = fields[fieldName];
    const timestamp: number = typeof value === 'number'
      ? value
      : typeof value === 'string' ? Date.parse(value) : Number.NaN;
    return Number.isFinite(timestamp)
      ? new Date(timestamp).toISOString()
      : null;
  }

  private sourceVersion(value: number | undefined): string | null {
    return value === undefined ? null : new Date(value).toISOString();
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
