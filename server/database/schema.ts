/* eslint-disable */
/** auto generated, do not edit */
import { sql } from 'drizzle-orm';
import { bigint, boolean, date, foreignKey, index, integer, pgTable, text, uuid, varchar, customType } from "drizzle-orm/pg-core"

export const customTimestamptz = customType<{
  data: Date;
  driverData: string;
  config: { precision?: number };
}>({
  dataType(config) {
    const precision = typeof config?.precision !== 'undefined'
      ? ` (${config.precision})`
      : '';
    return `timestamptz${precision}`;
  },
  toDriver(value: Date | string | number) {
    if (value == null) return value as any;
    if (typeof value === 'number') return new Date(value).toISOString();
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    throw new Error('Invalid timestamp value');
  },
  fromDriver(value: string | Date): Date {
    if (value instanceof Date) return value;
    return new Date(value);
  },
});

export const userProfile = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return 'user_profile';
  },
  toDriver(value: string) {
    return sql`ROW(${value})::user_profile`;
  },
  fromDriver(value: string) {
    const [userId] = value.slice(1, -1).split(',');
    return userId.trim();
  },
});

export type FileAttachment = {
  bucket_id: string;
  file_path: string;
};

export const fileAttachment = customType<{
  data: FileAttachment;
  driverData: string;
}>({
  dataType() {
    return 'file_attachment';
  },
  toDriver(value: FileAttachment) {
    return sql`ROW(${value.bucket_id},${value.file_path})::file_attachment`;
  },
  fromDriver(value: string): FileAttachment {
    const [bucketId, filePath] = value.slice(1, -1).split(',');
    return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
  },
});

export function escapeLiteral(str: string): string {
  return "'" + str.replace(/'/g, "''") + "'";
}

export const userProfileArray = customType<{
  data: string[];
  driverData: string;
}>({
  dataType() {
    return 'user_profile[]';
  },
  toDriver(value: string[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::user_profile[]`;
    }
    const elements = value.map(id => `ROW(${escapeLiteral(id)})::user_profile`).join(',');
    return sql.raw(`ARRAY[${elements}]::user_profile[]`);
  },
  fromDriver(value: string): string[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => m.slice(1, -1).split(',')[0].trim());
  },
});

export const fileAttachmentArray = customType<{
  data: FileAttachment[];
  driverData: string;
}>({
  dataType() {
    return 'file_attachment[]';
  },
  toDriver(value: FileAttachment[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::file_attachment[]`;
    }
    const elements = value.map(f =>
      `ROW(${escapeLiteral(f.bucket_id)},${escapeLiteral(f.file_path)})::file_attachment`
    ).join(',');
    return sql.raw(`ARRAY[${elements}]::file_attachment[]`);
  },
  fromDriver(value: string): FileAttachment[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => {
      const [bucketId, filePath] = m.slice(1, -1).split(',');
      return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
    });
  },
});

export const salesPlaybooks = pgTable("sales_playbooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull(),
  stage: varchar("stage", { length: 50 }).notNull(),
  pattern: text("pattern").notNull(),
  evidence: text("evidence"),
  applicableWhen: text("applicable_when"),
  successSignal: text("success_signal"),
  sampleSize: integer("sample_size").notNull().default(0),
  adoptionCount: integer("adoption_count").notNull().default(0),
  status: varchar("status", { length: 30 }).notNull().default('draft'),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: customTimestamptz("created_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("updated_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const salesInsights = pgTable("sales_insights", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id"),
  opportunityId: uuid("opportunity_id"),
  followupId: uuid("followup_id"),
  category: varchar("category", { length: 50 }).notNull(),
  title: varchar("title", { length: 240 }).notNull(),
  content: text("content").notNull(),
  evidence: text("evidence"),
  recommendedAction: text("recommended_action"),
  severity: varchar("severity", { length: 20 }).notNull().default('info'),
  status: varchar("status", { length: 30 }).notNull().default('open'),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: customTimestamptz("created_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("updated_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_insights_opportunity").on(table.opportunityId, table.createdAt),
  foreignKey({
    columns: [table.customerId],
    foreignColumns: [customers.id],
    name: "sales_insights_customer_id_fkey",
  }).onDelete("set null"),
  foreignKey({
    columns: [table.opportunityId],
    foreignColumns: [opportunities.id],
    name: "sales_insights_opportunity_id_fkey",
  }).onDelete("set null"),
  foreignKey({
    columns: [table.followupId],
    foreignColumns: [followups.id],
    name: "sales_insights_followup_id_fkey",
  }).onDelete("set null"),
]);

export const salesTasks = pgTable("sales_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id"),
  opportunityId: uuid("opportunity_id"),
  followupId: uuid("followup_id"),
  ownerMemberId: uuid("owner_member_id"),
  title: varchar("title", { length: 240 }).notNull(),
  description: text("description"),
  dueAt: customTimestamptz("due_at", { precision: 6 }),
  status: varchar("status", { length: 30 }).notNull().default('todo'),
  priority: varchar("priority", { length: 20 }).notNull().default('medium'),
  aiGenerated: boolean("ai_generated").notNull().default(false),
  completionEvidence: text("completion_evidence"),
  completedAt: customTimestamptz("completed_at", { precision: 6 }),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: customTimestamptz("created_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("updated_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_tasks_owner_status").on(table.ownerMemberId, table.status, table.dueAt),
  foreignKey({
    columns: [table.customerId],
    foreignColumns: [customers.id],
    name: "sales_tasks_customer_id_fkey",
  }).onDelete("set null"),
  foreignKey({
    columns: [table.opportunityId],
    foreignColumns: [opportunities.id],
    name: "sales_tasks_opportunity_id_fkey",
  }).onDelete("set null"),
  foreignKey({
    columns: [table.followupId],
    foreignColumns: [followups.id],
    name: "sales_tasks_followup_id_fkey",
  }).onDelete("set null"),
  foreignKey({
    columns: [table.ownerMemberId],
    foreignColumns: [salesMembers.id],
    name: "sales_tasks_owner_member_id_fkey",
  }).onDelete("set null"),
]);

export const followups = pgTable("followups", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull(),
  opportunityId: uuid("opportunity_id"),
  ownerMemberId: uuid("owner_member_id"),
  sourceType: varchar("source_type", { length: 30 }).notNull().default('text'),
  channel: varchar("channel", { length: 50 }).notNull().default('meeting'),
  occurredAt: customTimestamptz("occurred_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  rawContent: text("raw_content").notNull(),
  summary: text("summary"),
  customerNeeds: text("customer_needs"),
  objections: text("objections"),
  decisions: text("decisions"),
  nextPlan: text("next_plan"),
  qualityScore: integer("quality_score").notNull().default(0),
  riskLevel: varchar("risk_level", { length: 30 }).notNull().default('unknown'),
  aiStatus: varchar("ai_status", { length: 30 }).notNull().default('pending'),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: customTimestamptz("created_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("updated_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_followups_opportunity").on(table.opportunityId, table.occurredAt),
  foreignKey({
    columns: [table.customerId],
    foreignColumns: [customers.id],
    name: "followups_customer_id_fkey",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.opportunityId],
    foreignColumns: [opportunities.id],
    name: "followups_opportunity_id_fkey",
  }).onDelete("set null"),
  foreignKey({
    columns: [table.ownerMemberId],
    foreignColumns: [salesMembers.id],
    name: "followups_owner_member_id_fkey",
  }).onDelete("set null"),
]);

export const opportunities = pgTable("opportunities", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull(),
  ownerMemberId: uuid("owner_member_id"),
  name: varchar("name", { length: 200 }).notNull(),
  stage: varchar("stage", { length: 50 }).notNull().default('discovery'),
  status: varchar("status", { length: 30 }).notNull().default('open'),
  amount: bigint("amount", { mode: 'number' }).notNull().default(0),
  probability: integer("probability").notNull().default(10),
  expectedCloseDate: date("expected_close_date"),
  source: varchar("source", { length: 100 }),
  summary: text("summary"),
  methodologyNotes: text("methodology_notes"),
  riskLevel: varchar("risk_level", { length: 30 }).notNull().default('low'),
  nextAction: text("next_action"),
  lastActivityAt: customTimestamptz("last_activity_at", { precision: 6 }),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: customTimestamptz("created_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("updated_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_opportunities_customer").on(table.customerId),
  index("idx_opportunities_stage").on(table.stage, table.status),
  foreignKey({
    columns: [table.customerId],
    foreignColumns: [customers.id],
    name: "opportunities_customer_id_fkey",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.ownerMemberId],
    foreignColumns: [salesMembers.id],
    name: "opportunities_owner_member_id_fkey",
  }).onDelete("set null"),
]);

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull(),
  industry: varchar("industry", { length: 100 }),
  sizeRange: varchar("size_range", { length: 50 }),
  region: varchar("region", { length: 100 }),
  website: varchar("website", { length: 500 }),
  primaryContact: varchar("primary_contact", { length: 100 }),
  contactTitle: varchar("contact_title", { length: 100 }),
  contactPhone: varchar("contact_phone", { length: 50 }),
  contactEmail: varchar("contact_email", { length: 200 }),
  ownerMemberId: uuid("owner_member_id"),
  healthStatus: varchar("health_status", { length: 30 }).notNull().default('stable'),
  tags: text("tags"),
  notes: text("notes"),
  lastContactAt: customTimestamptz("last_contact_at", { precision: 6 }),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: customTimestamptz("created_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("updated_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_customers_owner").on(table.ownerMemberId),
  foreignKey({
    columns: [table.ownerMemberId],
    foreignColumns: [salesMembers.id],
    name: "customers_owner_member_id_fkey",
  }).onDelete("set null"),
]);

export const salesMembers = pgTable("sales_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: varchar("user_id", { length: 255 }),
  displayName: varchar("display_name", { length: 100 }).notNull(),
  role: varchar("role", { length: 50 }).notNull().default('sales'),
  department: varchar("department", { length: 100 }),
  targetAmount: bigint("target_amount", { mode: 'number' }).notNull().default(0),
  avatarColor: varchar("avatar_color", { length: 20 }).notNull().default('#2f6bff'),
  isActive: boolean("is_active").notNull().default(true),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: customTimestamptz("created_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: customTimestamptz("updated_at", { precision: 6 }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

// table aliases
export const customersTable = customers;
export const followupsTable = followups;
export const opportunitiesTable = opportunities;
export const salesInsightsTable = salesInsights;
export const salesMembersTable = salesMembers;
export const salesPlaybooksTable = salesPlaybooks;
export const salesTasksTable = salesTasks;
