import type {
  CustomerCommunicationAngle,
  CustomerCommunicationDraft,
  CustomerCommunicationEvidence,
  CustomerCommunicationMaterial,
  CustomerCommunicationObjective,
  CustomerCommunicationPreparationResponse,
  CustomerCommunicationQuestion,
  CustomerVisitBriefingOpportunity,
  CustomerVisitBriefingResponse,
} from '@shared/api.interface';

const sourceKey = (
  kind: CustomerCommunicationEvidence['kind'],
  recordId: string,
): string => `${kind}:${recordId}`;

const uniqueKeys = (keys: string[]): string[] => Array.from(new Set(keys));

const activeOpportunities = (
  briefing: CustomerVisitBriefingResponse,
): CustomerVisitBriefingOpportunity[] => briefing.opportunities.filter(
  (opportunity: CustomerVisitBriefingOpportunity): boolean =>
    opportunity.lifecycleStatus === 'active' ||
    opportunity.lifecycleStatus === 'unknown',
);

const opportunityEvidenceValue = (
  opportunity: CustomerVisitBriefingOpportunity,
): string => {
  const facts: string[] = [opportunity.name];
  if (opportunity.progress?.trim()) {
    facts.push(`当前进展：${opportunity.progress.trim()}`);
  }
  if (opportunity.nextAction?.trim()) {
    facts.push(`原定下一步：${opportunity.nextAction.trim()}`);
  }
  if (opportunity.recommendation?.action.trim()) {
    facts.push(`建议核对：${opportunity.recommendation.action.trim()}`);
  }
  return facts.join('；');
};

const buildCommunicationEvidence = (
  briefing: CustomerVisitBriefingResponse,
): CustomerCommunicationEvidence[] => {
  if (briefing.customer === null) return [];
  const customer: CustomerCommunicationEvidence = {
    key: sourceKey('customer', briefing.customer.recordId),
    kind: 'customer',
    label: briefing.customer.name,
    value: briefing.customer.latestSummary?.trim() ||
      `客户记录：${briefing.customer.name}`,
    occurredAt: briefing.customer.lastFollowupAt,
    source: briefing.customer.source,
  };
  const opportunities: CustomerCommunicationEvidence[] =
    briefing.opportunities.map(
      (
        opportunity: CustomerVisitBriefingOpportunity,
      ): CustomerCommunicationEvidence => ({
        key: sourceKey('opportunity', opportunity.recordId),
        kind: 'opportunity',
        label: opportunity.name,
        value: opportunityEvidenceValue(opportunity),
        occurredAt: null,
        source: opportunity.source,
      }),
    );
  const followups: CustomerCommunicationEvidence[] =
    briefing.recentFollowups.map(
      (followup): CustomerCommunicationEvidence => ({
        key: sourceKey('followup', followup.recordId),
        kind: 'followup',
        label: followup.opportunityName
          ? `${followup.opportunityName} 跟进`
          : '客户跟进',
        value: followup.summary,
        occurredAt: followup.communicationAt,
        source: followup.source,
      }),
    );
  return [customer, ...opportunities, ...followups];
};

const buildCommunicationObjective = (
  briefing: CustomerVisitBriefingResponse,
): CustomerCommunicationObjective => {
  const customer = briefing.customer;
  if (customer === null) {
    throw new Error('Customer is required to build communication objective');
  }
  const active: CustomerVisitBriefingOpportunity[] =
    activeOpportunities(briefing);
  const top: CustomerVisitBriefingOpportunity | undefined = active[0];
  if (!top) {
    return {
      id: 'discover-current-needs',
      title: `确认${customer.name}当前变化与新需求`,
      detail: '核对客户当前目标、参与角色和优先级，确认是否出现需要继续推进的合作机会。',
      sourceKeys: [sourceKey('customer', customer.recordId)],
    };
  }
  const recommendedAction: string = top.recommendation?.action.trim() ||
    top.nextAction?.trim() ||
    `确认${top.name}当前进展和双方下一步`;
  return {
    id: `advance-${top.recordId}`,
    title: `推进${top.name}的下一承诺`,
    detail: `围绕“${recommendedAction}”，确认客户当前判断、阻塞和双方下一步。`,
    sourceKeys: [sourceKey('opportunity', top.recordId)],
  };
};

const buildCommunicationAngles = (
  briefing: CustomerVisitBriefingResponse,
): CustomerCommunicationAngle[] => {
  const customer = briefing.customer;
  if (customer === null) return [];
  const angles: CustomerCommunicationAngle[] = [];
  if (customer.latestSummary?.trim()) {
    angles.push({
      id: 'customer-current-state',
      title: '从客户当前重点切入',
      guidance: `先核对已有摘要“${customer.latestSummary.trim()}”是否仍然准确，再确认最近变化。`,
      sourceKeys: [sourceKey('customer', customer.recordId)],
    });
  } else {
    angles.push({
      id: 'customer-context-gap',
      title: '先补齐客户当前背景',
      guidance: '现有客户摘要不足，先确认本次沟通缘由、当前目标和参与角色。',
      sourceKeys: [sourceKey('customer', customer.recordId)],
    });
  }

  const active: CustomerVisitBriefingOpportunity[] =
    activeOpportunities(briefing);
  const top: CustomerVisitBriefingOpportunity | undefined = active[0];
  if (top) {
    const focus: string = top.recommendation?.action.trim() ||
      top.risks[0]?.title ||
      top.gaps[0]?.title ||
      top.progress?.trim() ||
      '当前推进条件';
    angles.push({
      id: `opportunity-${top.recordId}`,
      title: `围绕${top.name}核对推进条件`,
      guidance: `把“${focus}”作为讨论重点，避免把尚未确认的信息表达成既成事实。`,
      sourceKeys: [sourceKey('opportunity', top.recordId)],
    });
  }

  const recent = briefing.recentFollowups[0];
  if (recent) {
    angles.push({
      id: `followup-${recent.recordId}`,
      title: '衔接最近一次可信沟通',
      guidance: `从“${recent.summary}”继续，先确认情况是否变化，再进入新的问题。`,
      sourceKeys: [sourceKey('followup', recent.recordId)],
    });
  } else if (angles.length < 3) {
    angles.push({
      id: 'agree-next-step',
      title: '以明确下一步收口',
      guidance: '沟通结束前确认双方动作、责任人和时间；任何写回或建任务都在会后另行确认。',
      sourceKeys: top
        ? [sourceKey('opportunity', top.recordId)]
        : [sourceKey('customer', customer.recordId)],
    });
  }
  return angles.slice(0, 3);
};

const buildCommunicationQuestions = (
  briefing: CustomerVisitBriefingResponse,
): CustomerCommunicationQuestion[] => {
  if (briefing.customer === null) return [];
  const customerRecordId: string = briefing.customer.recordId;
  return briefing.questions.map((question): CustomerCommunicationQuestion => ({
    ...question,
    sourceKeys: question.opportunityRecordId
      ? [sourceKey('opportunity', question.opportunityRecordId)]
      : [sourceKey('customer', customerRecordId)],
  }));
};

const pendingMaterial = (
  material: Omit<CustomerCommunicationMaterial, 'status'>,
): CustomerCommunicationMaterial => ({
  ...material,
  status: 'material_pending',
});

const buildCommunicationMaterials = (
  briefing: CustomerVisitBriefingResponse,
  questions: CustomerCommunicationQuestion[],
): CustomerCommunicationMaterial[] => {
  const customer = briefing.customer;
  if (customer === null) return [];
  const customerKey: string = sourceKey('customer', customer.recordId);
  const materials: CustomerCommunicationMaterial[] = [pendingMaterial({
    id: 'customer-context',
    category: 'customer_context',
    title: '客户背景与最近变化摘要',
    purpose: '让参与沟通的人先对齐客户当前目标、联系人和已知变化。',
    reason: '本次沟通应从客户本人范围内的记录开始，不依赖记忆补充。',
    sourceKeys: [customerKey],
  })];

  if (questions.length > 0) {
    materials.push(pendingMaterial({
      id: 'needs-checklist',
      category: 'needs_checklist',
      title: '需求与待确认问题清单',
      purpose: '逐项确认缺失信息，避免把问题当作已经确认的结论。',
      reason: '拜访攻略仍存在需要客户或销售确认的问题。',
      sourceKeys: uniqueKeys(
        questions.flatMap(
          (question: CustomerCommunicationQuestion): string[] =>
            question.sourceKeys,
        ),
      ),
    }));
  }

  const active: CustomerVisitBriefingOpportunity[] =
    activeOpportunities(briefing);
  const top: CustomerVisitBriefingOpportunity | undefined = active[0];
  if (top) {
    const opportunityKey: string = sourceKey('opportunity', top.recordId);
    materials.push(pendingMaterial({
      id: `solution-${top.recordId}`,
      category: 'solution_overview',
      title: '与当前需求相关的方案概览',
      purpose: '在客户确认需求后，用于说明可讨论的解决方向和边界。',
      reason: `${top.name}仍在推进，具体产品能力需要从可信资料库另行选取。`,
      sourceKeys: [opportunityKey],
    }));
    materials.push(pendingMaterial({
      id: `case-${top.recordId}`,
      category: 'case_reference',
      title: '与当前场景相关的客户案例',
      purpose: '在需求得到确认后补充可信案例，不在当前页面虚构案例内容。',
      reason: `${top.name}需要场景佐证，但 v1 尚未接入经审核案例库。`,
      sourceKeys: [opportunityKey],
    }));
    if (top.expectedAmount !== null) {
      materials.push(pendingMaterial({
        id: `commercial-${top.recordId}`,
        category: 'commercial_boundary',
        title: '商务与报价边界核对材料',
        purpose: '仅用于内部核对可讨论范围，不直接形成对客户的价格承诺。',
        reason: `${top.name}已有金额记录，仍需使用已审核报价资料人工核对。`,
        sourceKeys: [opportunityKey],
      }));
    }
  }

  materials.push(pendingMaterial({
    id: 'meeting-agenda',
    category: 'meeting_agenda',
    title: '本次沟通议程',
    purpose: '按客户现状、重点问题和双方下一步组织沟通顺序。',
    reason: '根据当前拜访攻略整理，需由销售结合实际参会人调整。',
    sourceKeys: uniqueKeys([
      customerKey,
      ...active.slice(0, 1).map(
        (opportunity: CustomerVisitBriefingOpportunity): string =>
          sourceKey('opportunity', opportunity.recordId),
      ),
    ]),
  }));
  return materials;
};

const draftQuestionLines = (
  questions: CustomerCommunicationQuestion[],
): string[] => questions.slice(0, 3).map(
  (question: CustomerCommunicationQuestion): string =>
    `- ${question.question}`,
);

const buildCommunicationDrafts = (
  briefing: CustomerVisitBriefingResponse,
  objective: CustomerCommunicationObjective,
  questions: CustomerCommunicationQuestion[],
): CustomerCommunicationDraft[] => {
  const customer = briefing.customer;
  if (customer === null) return [];
  const greeting: string = customer.contactName?.trim()
    ? `${customer.contactName.trim()}，您好！`
    : '您好！';
  const questionLines: string[] = draftQuestionLines(questions);
  const questionBlock: string = questionLines.length > 0
    ? `\n\n也希望和您确认几个问题：\n${questionLines.join('\n')}`
    : '';
  const active: CustomerVisitBriefingOpportunity[] =
    activeOpportunities(briefing);
  const top: CustomerVisitBriefingOpportunity | undefined = active[0];
  const topic: string = top
    ? `${top.name}的当前进展和下一步`
    : '当前重点和新的合作需求';
  const sourceKeys: string[] = uniqueKeys([
    sourceKey('customer', customer.recordId),
    ...objective.sourceKeys,
    ...questions.slice(0, 3).flatMap(
      (question: CustomerCommunicationQuestion): string[] =>
        question.sourceKeys,
    ),
  ]);
  const commonClosing = '如果方便，也想一起确认后续动作、责任人和时间。以上内容可根据实际情况调整。';
  return [{
    channel: 'feishu',
    title: '飞书沟通草稿',
    subject: null,
    body: `${greeting}\n\n想和您沟通一下${topic}。${questionBlock}\n\n${commonClosing}`,
    editable: true,
    execution: 'preview_only',
    sourceKeys,
  }, {
    channel: 'email',
    title: '邮件沟通草稿',
    subject: `关于${customer.name}${topic}的沟通确认`,
    body: `${greeting}\n\n希望和您安排一次沟通，重点确认${topic}。${questionBlock}\n\n${commonClosing}`,
    editable: true,
    execution: 'preview_only',
    sourceKeys,
  }];
};

const buildCustomerCommunicationPreparation = (
  briefing: CustomerVisitBriefingResponse,
  generatedAt: string,
): CustomerCommunicationPreparationResponse => {
  if (
    briefing.customer === null ||
    briefing.status === 'empty' ||
    briefing.status === 'unavailable'
  ) {
    return {
      referenceDate: briefing.referenceDate,
      timezone: briefing.timezone,
      status: briefing.status,
      generatedAt,
      customer: null,
      objective: null,
      angles: [],
      questions: [],
      materials: [],
      materialSearch: {
        status: 'no_trusted_match',
        configuredSourceCount: 0,
        checkedSourceCount: 0,
        trustedResultCount: 0,
        warnings: ['客户信息不足，未检索资料'],
      },
      drafts: [],
      evidence: [],
      coverage: briefing.coverage,
      warnings: briefing.warnings,
    };
  }
  const objective: CustomerCommunicationObjective =
    buildCommunicationObjective(briefing);
  const questions: CustomerCommunicationQuestion[] =
    buildCommunicationQuestions(briefing);
  return {
    referenceDate: briefing.referenceDate,
    timezone: briefing.timezone,
    status: briefing.status,
    generatedAt,
    customer: briefing.customer,
    objective,
    angles: buildCommunicationAngles(briefing),
    questions,
    materials: buildCommunicationMaterials(briefing, questions),
    materialSearch: {
      status: 'not_configured',
      configuredSourceCount: 0,
      checkedSourceCount: 0,
      trustedResultCount: 0,
      warnings: ['资料库尚未配置'],
    },
    drafts: buildCommunicationDrafts(briefing, objective, questions),
    evidence: buildCommunicationEvidence(briefing),
    coverage: briefing.coverage,
    warnings: briefing.warnings,
  };
};

export {
  buildCustomerCommunicationPreparation,
};
