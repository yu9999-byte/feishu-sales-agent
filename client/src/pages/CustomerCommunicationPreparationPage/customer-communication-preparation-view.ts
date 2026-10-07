import type {
  CustomerCommunicationDraftChannel,
  CustomerCommunicationEvidenceKind,
  CustomerCommunicationMaterial,
  CustomerCommunicationPreparationStatus,
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

const customerCommunicationStatusLabel = (
  status: CustomerCommunicationPreparationStatus,
): string => STATUS_LABELS[status];

const customerCommunicationEvidenceKindLabel = (
  kind: CustomerCommunicationEvidenceKind,
): string => EVIDENCE_KIND_LABELS[kind];

const customerCommunicationMaterialStatusLabel = (
  status: CustomerCommunicationMaterial['status'],
): string => status === 'material_pending' ? '材料待补充' : status;

const customerCommunicationDraftChannelLabel = (
  channel: CustomerCommunicationDraftChannel,
): string => DRAFT_CHANNEL_LABELS[channel];

export {
  customerCommunicationDraftChannelLabel,
  customerCommunicationEvidenceKindLabel,
  customerCommunicationMaterialStatusLabel,
  customerCommunicationStatusLabel,
};

