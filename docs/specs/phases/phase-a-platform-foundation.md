# Phase A 平台基线与产品外壳

状态：`Implementing / 2026-09-19`

关联需求：`PLT-001..006`、`WEB-001..003`

## 1. 交付目标

Phase A 建立后续所有 Agent 能力共用的租户、成员、角色、汇报范围、授权、审计、数据源端口
和 Web 产品外壳。它不实现客户 360、质检、Review 或 Playbook 业务，只提供这些模块必须
复用的平台契约。

为保持纵向可验收，Phase A 分为三个切片：

| 切片 | 可运行结果 |
| --- | --- |
| A1 授权内核 | 纯领域授权决策、租户隔离、递归汇报范围、审计输入和单元测试 |
| A2 Web 外壳 | 当前会话 API、按角色导航、工作台、无权页和完整页面状态 |
| A3 持久化与真实身份 | 新平台表、Repository、飞书身份绑定、四角色/两租户真实验收 |

## 2. A1 领域契约

### 2.1 角色与动作

角色固定为 `sales | manager | executive | admin`。首批受控动作：

- `workspace:view`
- `followup:create-own`
- `followup:confirm-own`
- `followup:read`
- `customer:read`
- `opportunity:read`
- `task:read`
- `task:assign`
- `review:read-personal`
- `review:read-team`
- `analytics:read`
- `playbook:read`
- `playbook:review`
- `playbook:publish`
- `admin:manage-members`
- `admin:manage-policies`
- `audit:read`

资源范围固定为 `self | team | tenant | granted`。`admin` 的全租户管理范围不自动授予代表
销售确认跟进的权限。

### 2.2 授权请求

```text
tenantId
actorMemberId
action
resourceType
resourceTenantId
resourceOwnerMemberId?
resourceRef?
occurredAt
```

`tenantId` 和行为人身份来自可信服务端上下文，不接受浏览器请求体覆盖。

### 2.3 授权结果

```text
allowed
reasonCode
effectiveRoles
dataScope
policyVersion
```

允许的 `reasonCode`：`allowed`、`tenant-mismatch`、`membership-inactive`、
`permission-missing`、`outside-data-scope`、`grant-expired`。对外 HTTP 不返回细分原因；细分原因
只进入脱敏审计。

### 2.4 决策顺序

1. 请求租户、成员租户和资源租户必须一致。
2. 成员必须处于 active 且角色分配在有效期内。
3. 角色必须拥有动作权限。
4. 计算 self、递归 team、tenant 或显式 grant 范围。
5. 资源必须落入有效范围；临时授权必须未过期。
6. 返回策略版本，调用方将同一决策摘要写入审计。

发生循环汇报关系时停止遍历并记录配置异常，不能无限递归或扩大范围。

## 3. A2 HTTP API 契约

共享类型必须先写入 `shared/api.interface.ts`。

### 3.1 `GET /api/platform/session`

返回当前已认证用户在当前租户中的产品会话：

```text
tenant { id, name, timezone }
member { id, feishuOpenId, displayName }
roles[]
permissions[]
navigation[]
policyVersion
```

客户端不得提交 `tenantId`。未绑定成员返回统一 `403 ACCESS_DENIED`；租户停用返回同一外部
错误，不能让客户端判断租户是否存在。

### 3.2 `GET /api/platform/workspace`

返回工作台外壳数据：待处理数量、风险入口、常用动作、数据更新时间和数据完整性状态。
Phase A 没有业务数据时使用真实空聚合，不使用硬编码示例记录。

### 3.3 错误信封

```text
code: ACCESS_DENIED | UNAUTHENTICATED | VALIDATION_FAILED |
      CONFLICT | DEPENDENCY_UNAVAILABLE | INTERNAL_ERROR
message: 面向用户的安全文案
traceId: 可用于审计检索的标识
retryable: boolean
```

## 4. A2 Web 路由与导航契约

Phase A 实现 `/` 工作台和以下受保护占位路由，以验证入口权限，不伪装对应业务已完成：

- `/reviews/team`
- `/analytics`
- `/admin/members`
- `/admin/audit`

占位页必须明确显示“该模块将在对应阶段实现”，不得展示模拟业务数据。权限规则：

| 路由 | sales | manager | executive | admin |
| --- | --- | --- | --- | --- |
| `/` | 允许 | 允许 | 允许 | 允许 |
| `/reviews/team` | 拒绝 | 允许 | 允许 | 可配置，默认允许 |
| `/analytics` | 个人摘要入口 | 团队 | 全租户 | 全租户 |
| `/admin/members` | 拒绝 | 拒绝 | 只读可配置，默认拒绝 | 允许 |
| `/admin/audit` | 拒绝 | 拒绝 | 默认拒绝 | 允许 |

前端隐藏无权入口，直接访问时由 API 再校验并显示不泄露资源内容的 forbidden 页面。

## 5. A3 数据模型

新表不复用旧单租户业务表。所有唯一约束、外键和索引显式包含租户范围。

| 表 | 关键字段与约束 |
| --- | --- |
| `tenant_members` | `(tenant_id,id)` 主范围，open/union/user id 映射，status |
| `role_assignments` | tenant/member/role/valid_from/valid_to，租户内唯一有效分配 |
| `reporting_relations` | tenant/manager/report/source/validity，禁止 self edge |
| `resource_grants` | tenant/resource/grantee/permission/expiry/grantor/reason |
| `data_source_bindings` | tenant/provider/credential_ref/mapping/version/enabled |
| `platform_audit_events` | tenant/trace/actor/action/resource/outcome/policy/details/time |

`credential_ref` 只保存环境变量或 Secret Manager 引用，不保存明文凭证。

## 6. 事件契约

Phase A 使用统一信封：

```text
eventId, tenantId, traceId, type, occurredAt, actorMemberId,
resourceRef, payloadVersion, payload
```

首批事件：

- `identity.member.bound.v1`
- `identity.role.changed.v1`
- `identity.reporting.changed.v1`
- `authorization.access.denied.v1`
- `datasource.binding.changed.v1`

消费者幂等键为 `(tenantId,eventId,consumer)`。事件载荷不得包含 Secret、认证头或客户原文。

## 7. 审计契约

授权拒绝、角色/汇报关系变更、数据源变更、管理员读取审计均必须留下审计输入。最少字段：

```text
tenantId, traceId, actorMemberId, roleSnapshot, action,
resourceType, resourceRefHash, outcome, reasonCode,
policyVersion, occurredAt
```

对未知或越权资源使用哈希后的引用，避免审计接口成为资源枚举通道。

## 8. 失败路径

| 场景 | 外部行为 | 内部行为 |
| --- | --- | --- |
| 无认证身份 | `401 UNAUTHENTICATED` | 记录请求 trace，不记录伪造身份 |
| 未绑定/停用成员 | `403 ACCESS_DENIED` | 记录统一拒绝与内部 reasonCode |
| 跨租户资源 | `403 ACCESS_DENIED` | 不查询目标租户详情，记录 tenant mismatch |
| 角色过期 | `403 ACCESS_DENIED` | 立即按当前时间失效 |
| 汇报关系成环 | 不扩大范围 | 记录配置异常并返回有限安全范围 |
| 临时授权过期 | `403 ACCESS_DENIED` | 不续期，不缓存旧授权 |
| Postgres 不可用 | `503 DEPENDENCY_UNAVAILABLE` | 有限重试，页面显示 error/partial |
| Base 绑定不可用 | 工作台标记 partial | 不影响纯平台设置读取 |

## 9. TDD 计划

### 9.1 A1 Red 测试

- 销售可读本人资源但不能读其他销售资源。
- 主管可读递归下属资源但不能读其他团队。
- 高管可读租户资源但不能执行管理员写操作。
- 管理员能管理成员但不能代表销售确认跟进。
- 同一成员在租户 A 与 B 的角色彼此独立。
- 跨租户资源即使 ID 相同也拒绝。
- 过期角色和过期 grant 拒绝。
- 汇报关系循环不会无限递归或扩大范围。
- 拒绝结果不包含资源存在性信息。
- 审计输入不含原始资源标识和 Secret 字段。

### 9.2 A2 契约与组件测试

- session API 只从可信上下文取租户和用户。
- 四类角色得到正确权限与导航。
- 直接访问无权路由仍被服务端拒绝。
- 工作台渲染 loading、empty、error、forbidden、stale、partial。
- 窄屏导航可操作，键盘焦点顺序正确。

### 9.3 A3 集成测试

- 迁移可在空库执行，并保留 P0 表与记录。
- 每个 Repository 查询显式包含 tenantId。
- 两租户相同成员外部 ID、资源 ID、事件 ID 不冲突。
- 角色和汇报关系更新后下一请求立即使用新策略。
- 审计记录追加而不是覆盖。

## 10. 验收矩阵

| 需求 | 自动化验收 | 真实 UI 验收 |
| --- | --- | --- |
| `PLT-001` | 两租户相同 ID 隔离测试 | 两企业切换后数据不串租户 |
| `PLT-002` | 同用户跨租户角色测试 | 同一用户进入两企业显示不同角色 |
| `PLT-003` | 四角色 + 递归汇报测试 | 四账号导航与范围核对 |
| `PLT-004` | 资源权限负向测试 | 复制越权链接返回统一 forbidden |
| `PLT-005` | 审计追加、脱敏测试 | 管理员页面可按 trace 回读 |
| `PLT-006` | 不存在/越权同响应测试 | 两类 URL 页面文案完全一致 |
| `WEB-001` | 路由与 API 双层权限测试 | 无权入口隐藏且直达被拒绝 |
| `WEB-002` | 七种状态组件测试 | 浏览器逐状态截图 |
| `WEB-003` | 深链签名/解析契约测试 | 飞书卡片打开正确页面 |

## 11. 完成门禁

1. A1 必须先保存 Red 失败证据，再写授权实现。
2. A2 在 shared API 契约完成后才实现 Controller 和页面。
3. A3 迁移先在隔离测试库执行；不得手改生成的 `server/database/schema.ts`。
4. 每个切片运行 P0 18 项回归，任何倒退先修复再继续。
5. 自动化通过不等于 UI 完成；四角色与两租户真实证据未齐时保持 `Implemented`。

## 12. TDD 证据日志

### A1 Red - 2026-09-19

命令：

```text
npm run test:agent -- tests/unit/authorization-policy.spec.ts
```

结果：失败，退出码 1。Vitest 无法解析
`@server/modules/identity-access/authorization-policy.service`，证明测试先于授权实现存在。本轮
Red 覆盖销售本人范围、递归团队范围、高管/管理员分权、跨租户、过期角色/授权、汇报环路和
审计脱敏。

### A1 Green - 2026-09-19

同一命令通过 10 项测试；随后全量 Agent 套件 28/28 通过，`type:check:test`、
`type:check:server` 和改动文件 ESLint 通过。P0 原有 18 项行为未回归。

### A2 Session Red - 2026-09-19

命令：

```text
npm run test:agent -- tests/unit/platform-session.spec.ts
```

结果：失败，退出码 1。Vitest 无法解析
`@server/modules/platform-shell/platform-session.service`，证明四角色会话与导航测试先于实现。

### A3 Repository Red - 2026-09-19

命令：

```text
npx vitest run --config vitest.integration.config.ts
```

结果：失败，退出码 1。Vitest 无法解析
`postgres-identity-access.repository`，证明真实 Postgres 租户隔离测试先于 Repository 和迁移。

### A2 Web Auth Red - 2026-09-19

命令：

```text
npm run test:agent -- tests/unit/feishu-web-auth.spec.ts
```

结果：失败，退出码 1。Vitest 无法解析 `feishu-web-auth.service`。Red 场景覆盖官方授权 URL、
一次性 state、重放防护、重定向白名单、OAuth tenant_key 校验、成员准入及会话明文不落库。

### A2/A3 Green 与真实 UI - 2026-09-19

- `npm run test:agent`：7 个文件、51 项通过；P0 原有工作流与失败恢复测试保持通过。
- `npx vitest run --config vitest.integration.config.ts`：5 项真实 Postgres 测试通过，覆盖两租户
  同 open_id 隔离、Repository 租户范围、审计追加、一次性 OAuth state 和会话撤销。
- `type:check:server`、`type:check:client`、`type:check:test`、相关目录 ESLint、Agent/Web
  构建均通过。
- 飞书安全设置已配置当前 HTTPS OAuth callback；真实账号完成 OAuth 并进入工作台，姓名由
  OAuth 用户信息同步，不新增通讯录读取权限。
- 真实 UI 验证了桌面工作台、管理员受保护入口、把同一成员改为销售后导航立即收敛且直达
  `/admin/members` 返回统一无权页，以及 390px 窄屏导航打开/关闭。
- `platform_audit_events` 已观察到 `workspace:view` 和 `admin:manage-members` 的 allowed/denied
  追加记录。当前仍缺四个真实角色账号和第二个真实飞书企业，因此 Phase A 不能标记 Complete。

### HTTP Security Red/Green - 2026-09-19

`feishu-web-auth.controller.spec.ts` 首次 4 项中 3 项失败，证实当时存在登出未校验 Origin、回调
异常外溢和 HTTPS 外非 production Cookie 未设 Secure。实现同源登出、统一安全错误与按公开源设置
Secure 后 4/4 通过。OAuth state/session token 均携带租户 UUID 范围且数据库只保存 SHA-256。
