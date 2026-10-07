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

const MATERIAL_SEARCH_NOTICES: Record<
  CustomerCommunicationMaterialSearchStatus,
  string
> = {
  ready: '推荐资料均已通过管理员白名单与本人权限核验，仍需人工判断是否适用。',
  not_configured: '当前租户尚未配置资料库，未命中的材料继续保持待补充。',
  no_trusted_match: '已检查可核验的白名单来源，但未找到可信材料。',
  partial: '可信推荐已通过权限核验，但部分来源暂时无法核验。',
  unavailable: '资料库暂时无法核验，系统不会用生成内容替代真实资料。',
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

const customerCommunicationMaterialSearchNotice = (
  status: CustomerCommunicationMaterialSearchStatus,
): string => MATERIAL_SEARCH_NOTICES[status];

const customerCommunicationDraftChannelLabel = (
  channel: CustomerCommunicationDraftChannel,
): string => DRAFT_CHANNEL_LABELS[channel];

export {
  customerCommunicationDraftChannelLabel,
  customerCommunicationEvidenceKindLabel,
  customerCommunicationMaterialSearchStatusLabel,
  customerCommunicationMaterialSearchNotice,
  customerCommunicationMaterialSourceTypeLabel,
  customerCommunicationMaterialStatusLabel,
  customerCommunicationStatusLabel,
};
