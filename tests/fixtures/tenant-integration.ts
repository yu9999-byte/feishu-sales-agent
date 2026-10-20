import type { TenantIntegration } from '@server/modules/agent-core/agent.types';

export const testIntegration: TenantIntegration = {
  tenantId: 'tenant',
  feishuTenantKey: 'tenant-key',
  name: 'Test tenant',
  status: 'active',
  appId: 'cli_test',
  appSecretEnv: 'TEST_SECRET',
  appType: 'selfBuild',
  base: {
    appToken: 'base-test',
    customers: {
      tableId: 'customers', primaryField: 'name',
      fields: { customerName: 'name' },
    },
    opportunities: {
      tableId: 'opportunities', primaryField: 'name',
      fields: { opportunityName: 'name', customerLink: 'customer' },
    },
    followups: {
      tableId: 'followups', primaryField: 'summary',
      fields: {
        sourceMessageId: 'message', customerLink: 'customer',
        opportunityLink: 'opportunity', rawText: 'text', summary: 'summary',
      },
    },
  },
};
