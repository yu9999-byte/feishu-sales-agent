# 技术架构

PLAYBOOK-DRAFT（2026-10-20）：独立控制库迁移 032；候选行锁 + expectedVersion CAS + requestId 幂等，锁内冻结来源；可信会话和 playbook:review 限制全部草稿接口。版本内容不接入 RAG。见 [SDD 51](specs/51-playbook-authoring-sdd.md)。

PREP-TEST-TYPES（2026-10-20，已完成）：测试配置显式覆盖继承的 spec exclude，采用匹配 Vitest/Vite 的 ESM/bundler 解析及 JSX，关闭仅生产构建需要的 composite/incremental，复用现有路径别名。覆盖回归先红复现 124 个 spec 遗漏，修正夹具与缺失导入后，136 个测试源文件全部入选且类型通过；全量 1052 单元及本轮 25 文件 ESLint 通过。未用 any、类型忽略或排除测试消除诊断，生产配置及契约未改。证据见 [验证归档](evidence/preparation-content-20261020/verification.md)。

PREP-WEB-ENTRY（2026-10-20，已实现）：独立 Vite 的 GET/HEAD HTML 导航选择 agent.html 并保留查询参数；16 项真实 HTTP 回归通过，内置浏览器深链刷新到达身份提示。测试服务器关闭 watcher/预转换，避免全量并行时无关预热导致超时。API/runtime/模块/静态请求与平台模板不变。

PREP-CONTENT 验收补充（2026-10-20）：准备包组件先判 lifecycleStatus，再判 health；active/unknown 的 null health 使用待核实标签，不能直接套用拜访页将 null 视为历史的格式函数。仅修改准备包组件，不扩大共享格式函数行为。

准备包内容完整性（2026-10-20，已实现）：可选 briefing 保存 metrics/opportunities/recentFollowups/agenda；empty/unavailable 为 null，原决策证据完整透传，Web 显示引用及缺失提示。JSONB 完整往返、快照不可变与隔离已验证；沿用权限重验及编辑 CAS，无新增迁移或外部调用。

## 客户沟通准备包 Goal v1（2026-10-19）

已确认启动，执行设计见 [SDD 49](specs/49-customer-preparation-chat-sdd.md)。先请求边界、客户解析与独立多轮状态，再组合既有服务接聊天和 Web。仅生成建议，权限/来源/幂等/人工边界不变；真实消息与业务写入不增加。当前实现中，不宣称可用。

## 到期提醒结果名称（2026-10-19）

到期稍后提醒使用简短按钮标签，结果不能显示“标记已处理：稍后提醒”。仅当通知 subjectKey 精确等于事项 ID 且只有一个事项范围时，使用冻结通知首个 section 的事项标题；其他通知沿用原标签后缀剥离，不猜测跨事项名称。回调、状态版本、投递键不变，先以真实 reminder planner 产物建立失败测试，再修复。跨日失效版本不迁移提醒，真实发送与业务写入额度不增加。

## 今日行动建议证据边界（2026-10-18）

商机建议动作与建议日期必须有非空且全部可解析的本商机 evidenceIds，不能只校验提醒原因的证据。建议引用为空或缺失时，保留有证据的提醒原因，建议降级为“核实并补充商机信息”，时间使用本次参考日；来源覆盖标记 partial 并提示建议未采用。不新增 Agent、外部写入或权限；不扩大来源读取范围。先补无引用、部分缺失与完整有效建议测试，再实现并验证。五类真实样本和聊天验收缺口仍独立保留。

## 聊天行动结果文案纠正（2026-10-18）

真实稍后提醒回显误用了同一事项第一个快捷按钮的标签，出现“标记已处理：稍后提醒”。结果应只展示事项名称和持久化实际状态，剥离已知操作后缀；保留名称内部标点和未识别标签，不改变回调参数、归属、版本、幂等键或其他事项入口。先以四种按钮顺序与名称含分隔符的失败用例验证，再修复并运行相关测试、类型/Lint/构建。真实卡片更新仍受现有授权额度约束，不为纯展示修复新增发送。

## 今日行动限定验收发送设计（2026-10-18）

新增独立手动入口，默认仅预览，显式send才投递；不调用整批run、不启用或改变定时配置。必须同时匹配现有租户/成员/收件人白名单、有效本人会话及customer/opportunity/task读取权限，且会话tenant/member/openId与白名单一致。按明确的1至2个事项ID从本人实时报告中选取，每项标题必须含完整TCL-UAT-YYYYMMDD标记，任何缺失、重复、非open或标记不符整批拒绝。只读取选中事项控制状态，不将历史事项、来源告警原文或其他报表纳入卡片。

复用今日行动卡片四操作、首次payload冻结、投递审计/重试/unknown保护；手动请求以稳定runKey和范围摘要绑定通知键，不用时间戳制造新键。预览返回将发送的卡片，发送最多一张；相同runKey始终占用同一投递槽；重试只使用账本冻结的首次payload，已发送或unknown不重新投递。不写Base/Task，不绕过卡片归属核验。真实场景仅使用剩余4条消息额度，业务额度2跟进/3任务不增加。

TDD覆盖：默认预览零投递；精确过滤且不泄漏历史；空/重复/缺失/非测试/非open拒绝；跨租户/成员/收件人、缺权拒绝；每次最多一张且键稳定；复用现有delivery的重复与unknown集成覆盖。完成后运行单元/集成/类型/Lint/双构建及真实卡片验收，缺样本单独阻塞。

2026-10-18增量：Web API聚合层统一axiosForBackend配置对象传递method/url/data，避免工具包全局Axios快捷方法重写丢失写语义。今日任务以完整作用域确定性UUIDv8持久化；task种类与shared校验一致。只读Feishu task限流码99991400有限退避并顺序读取详情；外部写沿用原幂等/人工确认。详见specs/47。

> 第 1–15 节保留 P0 架构基线。Goal v3 的原聊天卡片、草案版本、任务预览、条件推送与
> 状态回收在 `docs/specs/03-system-and-data-design.md` 和 Phase B 中演进；第 16 节记录
> 2026-09-20 增量，避免把旧 P0 的确认处理器误作新版已完成。
> 对话与卡片可用性增量见第 17 节和
> [新决策](decisions/2026-09-20-conversation-and-quality.md)。
> 2026-09-23 起，Agent 运行时迁移到 LangChain.js + LangGraph.js；具体边界和迁移门禁见第 18 节
> 与 [LangGraph Agent Runtime SDD](specs/10-langgraph-agent-runtime-sdd.md)。

## 1. 架构结论

P0 使用独立部署的 NestJS Agent 后端，不依赖妙搭运行时、妙搭数据库或妙搭 AI 插件。

- 飞书开放平台负责机器人、事件、消息卡片、Base 和任务 API。
- 项目代码负责 Agent 编排、确认状态机、租户隔离、幂等、审计和失败补偿。
- LLM Provider 负责模型推理，但不能直接调用业务写工具。
- 多维表格保存 Demo 客户、商机和跟进。
- 独立 Postgres 保存租户配置、会话、待确认动作、任务映射和审计。
- P0 没有前端构建产物和独立页面。

现有 NestJS 代码可作为语言和框架基础，但必须解除对妙搭运行时的依赖后才能进入目标架构。

## 2. 目标架构

```mermaid
flowchart TB
    subgraph Feishu[飞书]
      User[销售用户]
      Bot[机器人消息]
      Card[交互卡片]
      Base[多维表格]
      Task[飞书任务]
    end

    subgraph Service[独立 Agent 服务]
      Webhook[事件与卡片 Webhook]
      Security[验签、解密、去重]
      Tenant[租户解析与配置]
      Workflow[确定性 Agent 工作流]
      Schema[LLM Schema 校验]
      Tools[工具执行与补偿]
      Audit[审计与可观测性]
    end

    subgraph Providers[外部能力]
      LLM[LLM Provider]
      Db[(Postgres)]
    end

    User --> Bot
    Bot --> Webhook
    Card --> Webhook
    Webhook --> Security
    Security --> Tenant
    Tenant --> Workflow
    Workflow --> LLM
    LLM --> Schema
    Schema --> Workflow
    Workflow --> Card
    Workflow --> Tools
    Tools --> Base
    Tools --> Task
    Workflow --> Db
    Tools --> Audit
    Audit --> Db
```

## 3. P0 运行组件

| 组件 | 责任 | 不负责 |
| --- | --- | --- |
| Feishu Event Gateway | URL challenge、验签、解密、事件归一化 | 业务推理 |
| Tenant Resolver | `tenant_key` 到内部租户和配置的映射 | 接受客户端伪造租户 |
| Conversation Service | 合并多轮补充信息和过期处理 | 永久保存无关聊天 |
| Follow-up Extractor | 调用 LLM 并验证固定 Schema | 直接写 Base |
| Confirmation Service | 冻结草案、生成卡片、校验确认人和终态 | 重新推理已冻结草案 |
| Base Adapter | 按租户配置匹配并写客户、商机、跟进 | 写死表和字段 ID |
| Feishu Task Adapter | 创建任务并保存映射 | 自动向外部联系人发消息 |
| Audit Service | 记录状态、工具结果和失败原因 | 记录 Secret 或完整 Token |

## 4. 飞书应用形态

### P0

使用已有飞书自建应用“销售agent”在其所属测试企业完成真实演示。需要配置：

- 机器人能力。
- 接收私聊消息所需事件订阅和权限。
- 发送消息卡片及接收卡片动作所需权限。
- 多维表格读取和写入权限。
- 飞书任务创建权限。
- Event Subscription 的验证 Token、Encrypt Key 和公开 HTTPS 回调地址。

App Secret 必须重置，且只能通过环境变量或密钥管理服务提供。

### 多企业生产形态

自建应用只能在所属企业内使用。面向多个企业时，需要以下一种生产分发方式：

1. 飞书商店/ISV 应用，由各企业安装并产生独立租户上下文。
2. 每个企业提供独立应用凭证，由 SaaS 管理多套应用配置。

P0 不完成应用市场发布，但事件、配置和数据模型不得假设只有一个租户。

## 5. 事件处理流程

```text
POST /webhooks/feishu/events
  -> 验证 URL challenge / 请求签名
  -> 必要时解密事件
  -> 以 tenant_key 解析内部 tenant_id
  -> 使用 tenant_id + message_id 去重
  -> 只接受允许的私聊文本事件
  -> 投递 Agent 工作流
  -> 尽快响应飞书，异步完成模型和消息发送
```

```text
POST /webhooks/feishu/cards
  -> 验签与租户解析
  -> 读取不可变 pending_action
  -> 校验 actor_open_id、tenant_id、状态和有效期
  -> 原子抢占 Executing 状态
  -> 执行 Base 与 Task 工具
  -> 写入终态并更新卡片
```

具体路由可按飞书 SDK 要求合并，但安全和业务处理必须保持逻辑分层。

## 6. Agent 工作流

P0 不使用开放式无限循环 Agent。采用可测试的确定性状态机：

```text
COLLECTING
  -> EXTRACTING
  -> NEEDS_CLARIFICATION | PENDING_CONFIRMATION
  -> CANCELLED | EXECUTING | EXPIRED
  -> SUCCEEDED | PARTIAL_FAILURE | FAILED
```

允许 LLM 的步骤只有：

- 将用户原话转换为结构化跟进草案。
- 将补充回答合并到已有草案。
- 生成面向用户的简短说明。

客户匹配、字段完整度、租户路由、状态迁移、幂等和工具执行均由确定性代码控制。

## 7. LLM 契约

建议使用可替换的 OpenAI-compatible Provider 接口，模型和 Base URL 通过环境变量配置。

结构化输出示意：

```typescript
type FollowupDraft = {
  customerName: string | null;
  contactName: string | null;
  opportunityName: string | null;
  summary: string;
  customerNeeds: string[];
  objections: string[];
  risks: string[];
  progress: string | null;
  expectedAmount: number | null;
  nextAction: string | null;
  dueAt: string | null;
  evidenceQuotes: string[];
};
```

服务端使用 Zod 或等价 Schema 校验：

- 字段类型不合法时拒绝进入确认状态。
- 金额和时间通过确定性解析再次检查。
- `evidenceQuotes` 必须能在用户输入中找到。
- 关键字段缺失时生成追问，不允许模型凭空补齐。
- Prompt 版本和模型名称进入审计记录，API Key 不进入记录。

## 8. Base 数据适配

每个租户的数据源配置至少包含：

```text
tenant_id
base_token_reference
customer_table_id
opportunity_table_id
followup_table_id
field_mapping
enabled
```

Base Adapter 对上层暴露领域工具：

```typescript
findCustomerByName()
createCustomer()
findOpenOpportunities()
createOrUpdateOpportunity()
createFollowup()
```

领域工作流只认识标准字段，不认识具体中文列名或飞书字段 ID。适配器必须先读取并校验真实
Base Schema，再启用租户配置。

P0 通过用户身份创建 Demo Base；运行时优先使用租户范围的应用身份访问，并确保该应用已获得
Base 资源权限。若相关 API 必须使用用户授权，则增加最小 OAuth 授权，不在代码中模拟用户。

## 9. 内部数据模型

P0 独立数据库只保存控制数据，不复制全部业务数据。

| 表 | 关键字段 |
| --- | --- |
| `tenants` | `id`, `feishu_tenant_key`, `status` |
| `tenant_integrations` | `tenant_id`, 凭证引用、Base 配置、字段映射 |
| `agent_sessions` | `tenant_id`, `actor_open_id`, 状态、草案、过期时间 |
| `pending_actions` | `tenant_id`, 不可变 payload、确认人、状态、幂等键 |
| `task_mappings` | `tenant_id`, followup record ID、task GUID |
| `audit_events` | `tenant_id`, trace ID、事件类型、结果摘要、时间 |

所有唯一键和外键关系必须包含或可追溯到 `tenant_id`。Repository API 不提供无租户查询。

## 10. 凭证与环境变量

仅记录变量名，不在仓库提供真实值：

```text
FEISHU_APP_ID
FEISHU_APP_SECRET
FEISHU_VERIFICATION_TOKEN
FEISHU_ENCRYPT_KEY
LLM_BASE_URL
LLM_API_KEY
LLM_MODEL
DATABASE_URL
PUBLIC_BASE_URL
```

要求：

- 本地值进入被 Git 忽略的环境文件或系统密钥存储。
- 生产值进入托管平台的 Secret Manager。
- 日志对 Header、Token、Secret 和客户敏感原文做脱敏。
- Secret 轮换不要求修改代码或重新构建镜像。

## 11. 幂等与补偿

| 场景 | 幂等键 | 处理 |
| --- | --- | --- |
| 飞书重复消息事件 | `tenant_id + message_id` | 已处理则直接返回 |
| 卡片重复点击 | `tenant_id + pending_action_id` | 只有一次能进入 Executing |
| 客户创建 | `tenant_id + normalized_customer_name` | 先查询，冲突时停止 |
| 跟进创建 | `tenant_id + source_event_id` | 已存在则复用记录 |
| 任务创建 | `tenant_id + pending_action_id + task` | 先检查 task mapping |

外部调用结果必须逐步持久化。发生部分失败时，从最后一个已确认成功的步骤继续，不重放整个流程。

## 12. 目录建议

文档确认后再实施以下最小结构：

```text
server/
  modules/
    feishu-gateway/
    tenant/
    agent/
    integrations/
      base/
      task/
    audit/
  common/
    config/
    database/
    security/
  main.ts
tests/
  unit/
  integration/
  tenant-isolation/
```

现有 `client/` 不参与 P0 构建。遗留妙搭文件的删除或迁移需单独审阅。

## 13. 本地开发与部署

```text
飞书测试企业
  -> 公网 HTTPS 回调或安全开发隧道
  -> 本地/测试环境 NestJS
  -> 测试 Postgres
  -> Demo Base + 飞书任务
```

P0 发布到任意能够提供稳定 HTTPS、环境变量和 Postgres 的托管平台即可。平台选择不属于当前
文档决策；先保证代码不依赖某个托管商专有运行时。

## 14. 测试与验收

### 自动化

- FollowupDraft Schema 与字段完整度测试。
- 状态机合法迁移和过期测试。
- 重复事件、重复确认和部分失败补偿测试。
- Base 与 Task Adapter 契约测试。
- 两个模拟租户的配置、会话、动作和幂等隔离测试。
- Secret 与跨租户字段不得出现在日志的测试。

### 真实飞书

- URL challenge 和加密事件验证通过。
- 真实私聊触发 Agent。
- 真实确认卡片可执行和更新。
- 真实 Base 三表写入正确。
- 真实飞书任务创建成功。
- 取消、无权限和至少一个失败场景可见。

## 15. 集成阶段阻塞条件

出现以下任一情况且替代路径验证失败时停止，不继续猜测：

- 没有重置后的 App Secret 或必要飞书权限。
- 没有可访问的 HTTPS 回调地址。
- 没有可用 LLM 模型凭证。
- 自建应用身份无法访问 Demo Base，且用户 OAuth 也无法授权。
- Task API 无法以应用或授权用户身份创建任务。

停止时必须报告已尝试路径、飞书错误码、缺失权限或配置，以及唯一需要用户完成的动作。

## 16. Goal v3 卡片编排增量

```text
input job (tenant + actor + source chat)
  -> append-only draft version
  -> deterministic content review
  -> task candidates derived from the same exact version
  -> render/update draft card in source chat
  -> confirm(version + selectedTaskCandidateIds)
  -> lease execution once
  -> persist customer/opportunity/followup
  -> create only the selected, authorized tasks
  -> send result card to source chat
  -> enqueue project review and policy notifications
```

工程约束：

- 输入作业保存来源聊天 ID 和卡片消息 ID；所有补充、更新和结果路由回该聊天。卡片回调必须
  校验租户、提交人、消息/卡片归属、草案版本、有效期与幂等键。
- `followup_draft_versions` 只追加；保存前质量快照、证据和任务候选绑定精确版本。编辑或
  重新生成后旧确认失效，不能把旧卡的任务预览应用到新正文。
- 确认负载只携带服务器签发的草案/候选引用，不信任客户端提交的 tenant、actor、任务负责人
  或任意业务字段。本人任务可一次确认；他人负责人须经过授权服务并使用额外确认上下文。
- 执行器按步骤持久化 Base record ID 与 Task GUID。跟进未保存不得建任务；任务部分失败时
  outbox 只重试缺失任务。卡片更新失败不回滚业务终态，但必须可重新查询并补发。
- 保存后项目质检、跨角色推送、报告和提醒使用独立事件消费者和 outbox；资源授权在发送时
  重新检查。AI 任务状态判断写建议事件，用户确认后才调用 Task 更新接口。
- 飞书 Card 2.0 不提供按键级服务器检查：表单提交/检查回调后异步更新整张卡。Web 可即时
  计算确定性完整度；确认时以服务端同版本的阻断项、建议与内部兼容快照为准。

## 17. 对话路由与保存前可用性增量

```text
Feishu message
  -> tenant / actor / chat / message dedupe
  -> short-term memory read + versioned LLM intent classifier
  -> state-machine safety gate
  -> chat reply | clarification | authorized query | operation preview
  -> classified followup_capture enters FollowupExtractor
```

- 意图分类器只返回受 Schema 约束的意图、置信度和建议回复，不具有工具权限。自然语言主路由由
  LLM 完成；代码中的显式命令解析只在意图已经分类后负责提取跟进正文或打开空白录入表单，
  不能单独触发工具。低置信或 Schema 错误保守澄清/失败。
- 普通聊天、方法问答和内容草稿也写入租户/用户/聊天隔离的短期对话记忆，但不写客户、商机、
  跟进或任务。查询未接通时返回真实边界；后续数据问答必须复用授权与数据源端口。
- 跟进补充会话需增加 chat 归属检查；普通问答和换话题不能污染 `rawText`。
- `QualityAssessment` 旧数字字段暂保留以兼容历史草案和测试。Card renderer 改为推导
  `ready / needs_confirmation / suggestions`，默认不渲染分数和等级；Web 旧详情仍可回读快照。

## 18. LangChain/LangGraph 运行时与记忆分层增量（2026-09-23）

### 18.1 组件职责

| 组件 | 目标职责 | 迁移约束 |
| --- | --- | --- |
| LangChain.js | GLM/OpenAI-compatible 模型适配、提示词、structured output | 模型只能产生结构化建议，不能直接调用业务工具 |
| LangGraph.js | 唯一生产对话编排、状态图、interrupt/resume 和节点可观测性 | 替换当前自研主路由，不与旧路由长期并行 |
| LangGraph Postgres Checkpointer | thread 状态、短期上下文、暂停/恢复和状态快照 | 替换 `MemoryControlStore` 短期主路径，不承担长期语义记忆 |
| Mem0 OSS | 受策略控制的长期用户/销售语义记忆 | 经过 ACL、来源、删除和评测；不作为业务事实源 |
| Base / Feishu Task / 控制库 | 客户、商机、跟进、任务、授权、审计事实 | 保留现有适配器、确认门和幂等 |

### 18.2 Graph 主链路

```text
Feishu Webhook
  -> tenant / actor / chat / dedupe
  -> LangGraph StateGraph(thread_id)
  -> context(Checkpointer + ACL filtered Mem0)
  -> classifyIntent(LangChain structured output)
  -> routeIntent(deterministic safety gate)
  -> chat | clarify | followup extract | confirmation interrupt
  -> Base/Task tools after confirmation
  -> Checkpointer state + audit
```

`thread_id` 使用 `tenantId:actorOpenId:chatId`，所有恢复、记忆召回和工具调用都重新校验租户、
用户、聊天、草案版本、TTL 和权限。Mem0 写入只在业务动作成功且策略允许后异步进行，失败不
回滚业务事实，也不阻塞结果卡。

### 18.3 Mem0 适配层当前实现

长期语义记忆通过 `LongTermMemoryPort` 隔离 Mem0 OSS 细节。`Mem0MemoryAdapter` 当前默认关闭，
只有在 `MEM0_ENABLED=true` 且持久向量后端、embedding 和 LLM 配置齐全时才初始化。适配器使用
`sales-agent-long-term:{tenantId}:{actorOpenId}` 作为 Mem0 `user_id`，metadata 保存租户、销售、
客户引用、来源和策略版本，并在返回结果前执行二次 scope 校验。P0 尚不从 Graph 读取 Mem0，
也不在跟进确认流程中自动写入；这两个动作必须等 TDD 评测和异步失败降级完成后再单独启用。

### 18.4 迁移和回滚

先锁版本和状态契约，再写 Red 测试、替换意图路由、迁移 Checkpointer、评测 Mem0，最后删除旧
生产入口。迁移期间允许只读回放旧状态用于对账，但禁止旧/新实现长期双写双读；任一门禁未过时
回滚到上一已验证 Graph 构建，而不是用第二套运行时掩盖问题。

## 2026-10-16 行动中心技术增量
复用 insight 的 TaskFulfillment/OpportunityDecision 和本人 portfolio；增加聚合服务、共享契约、受认证 API 与控制库事项状态。动作幂等键绑定 tenant/member/来源/版本，通知沿用已有账本和 uncertain 处理；不得改为模型直接写业务源。详见 specs/47-trusted-followup-action-center-sdd.md。

2026-10-16 今日行动卡片：严格回调契约已补齐并通过 3 项测试；后续回调服务须独立完成本人权限、版本可见性和原卡绑定校验后方可调用状态仓储。契约解析本身不构成授权。

2026-10-17 主动提醒载荷一致性：迁移 024 在投递 claim 内持久化首次 message_payload；重试保留首次接收人/指纹并使用首次消息。快捷回调还须精确匹配持久化 shortcuts.value，避免本人原卡被用于未展示的操作。

### 卡片状态回显恢复切片（2026-10-17）
- 设计：基于已发送卡片冻结载荷与当前事项状态生成原卡片替换内容；保留其他事项与工作台入口，已处理/稍后提醒事项移除旧操作按钮。
- 恢复：回调重试重放持久操作结果，再按最新状态重建卡片；不新增消息、不重复业务写入。卡片返回失败仅影响展示，保留原操作键供重试。
- 验收：状态渲染覆盖多事项、旧版本隔离和重复重建；真实卡片展示仍待真实账号验收。

### 到期提醒调度切片（2026-10-17）
- 到期提醒沿用现有单租户、单成员、单收件人 rollout 与发送开关；task_action 启用时，在每次调度读取到期 snoozed 状态。
- 重新读取可见事项并精确匹配版本；事项失效、来源不可用或已处理时不发送。投递键由事项 ID、版本与状态 revision 组成，失败重试不提前消费提醒，未知投递由现有账本冻结。
- 普通每日摘要过滤已处理和稍后提醒事项，避免绕过提醒时间。每条提醒包含原因、证据、建议动作与完成日期。
- 验收先覆盖纯规划去重、过期版本和未到期过滤，再接生产调度并验证模块装配；真实发送单独确认。

### 完整行动摘要切片（2026-10-17）
- 飞书每日 task_action 摘要复用 TodayActionService，覆盖客户跟进、任务与商机信号，并读取持久状态过滤已处理/稍后提醒项。
- 每条展示原因、证据、建议动作、建议完成日期；来源降级明确显示。保持本人权限、现有 rollout、投递幂等与人工确认边界。
- 本切片先测试摘要内容与状态过滤，再接生产 runner；聊天业务草案快捷操作继续单独实现，不直接写业务数据。

### 聊天生成跟进入口切片
- 受冻结卡片回调、本人身份及 followup:create-own 权限约束；重新核对可见事项与版本。
- 创建确定性 PendingAction，复用现有真实沟通输入表单、质量检查、完整确认；建议动作不得伪装为已发生沟通。
- 替换原消息为输入表单，不发送新卡片；重复点击保留同一草案及当前内容，过期或已推进草案不得重置。

跟进快捷入口设计修订：保留多事项摘要，使用既有 sendConfirmationCard 的 action.id:confirmation-card 去重键创建独立输入卡；已绑定卡片时复用。避免摘要状态回调覆盖输入表单，保持不同事项草案来源唯一。此前“替换摘要原消息”方案已撤销。真实发送仍未执行。

### 聊天独立任务确认卡切片
创建任务快捷操作先生成本人可编辑草案，完整展示标题、截止时间、执行方式和参与人。确认回调携带 action ID 与版本；严格验证表单、身份、原卡片及租约后才调现有独立任务执行器。过期、重复、旧版本与失败恢复沿用持久状态边界。真实任务创建单独确认，开发验证不调用外部写入。

### Web 任务执行结果查询切片
新增本人任务草案只读状态查询，返回等待确认、执行中、成功或失败及原任务链接。服务端检查 task:read、本人归属与 task 类型；客户端不得通过确认接口轮询，避免读操作触发重试。后续工作台保存 action ID 并短轮询，失败显式重试原 action。
