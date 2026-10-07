import type {
  CustomerCommunicationDraftChannel,
  CustomerCommunicationEvidenceKind,
  CustomerCommunicationMaterial,
  CustomerCommunicationMaterialSearchStatus,
  CustomerCommunicationPreparationStatus,
  SalesMaterialSourceType,
} from '@shared/api.interface';

const STATUS_LABELS: Record<
  CustomerCommunicationPreparationStatus,
  string
> = {
  ready: '沟通内容已准备',
  partial: '部分内容可准备',
  empty: '客户不可见',
  unavailable: '暂时无法准备',
};

const EVIDENCE_KIND_LABELS: Record<
  CustomerCommunicationEvidenceKind,
  string
> = {
  customer: '客户',
  opportunity: '商机',
  followup: '跟进',
};

const DRAFT_CHANNEL_LABELS: Record<
  CustomerCommunicationDraftChannel,
  string
> = {
  feishu: '飞书消息',
  email: '邮件',
};

const MATERIAL_SEARCH_STATUS_LABELS: Record<
  CustomerCommunicationMaterialSearchStatus,
  string
> = {
  ready: '已找到可信材料',
  not_configured: '资料库尚未配置',
  no_trusted_match: '未找到可信材料',
  partial: '已找到部分可信材料',
  unavailable: '资料库暂时不可用',
};

const MATERIAL_SOURCE_TYPE_LABELS: Record<SalesMaterialSourceType, string> = {
  docx: '飞书文档',
  wiki: '飞书知识库',
};

const customerCommunicationStatusLabel = (
  status: CustomerCommunicationPreparationStatus,
): string => STATUS_LABELS[status];

const customerCommunicationEvidenceKindLabel = (
  kind: CustomerCommunicationEvidenceKind,
): string => EVIDENCE_KIND_LABELS[kind];

const customerCommunicationMaterialStatusLabel = (
  status: CustomerCommunicationMaterial['status'],
): string => status === 'material_pending' ? '材料待补充' : '可信资料';

const customerCommunicationMaterialSearchStatusLabel = (
  status: CustomerCommunicationMaterialSearchStatus,
): string => MATERIAL_SEARCH_STATUS_LABELS[status];

const customerCommunicationMaterialSourceTypeLabel = (
  sourceType: SalesMaterialSourceType,
): string => MATERIAL_SOURCE_TYPE_LABELS[sourceType];

const customerCommunicationDraftChannelLabel = (
  channel: CustomerCommunicationDraftChannel,
): string => DRAFT_CHANNEL_LABELS[channel];

export {
  customerCommunicationDraftChannelLabel,
  customerCommunicationEvidenceKindLabel,
  customerCommunicationMaterialSearchStatusLabel,
  customerCommunicationMaterialSourceTypeLabel,
  customerCommunicationMaterialStatusLabel,
  customerCommunicationStatusLabel,
};
