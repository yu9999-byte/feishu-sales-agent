# Agent Web SPA 未知路由回退 SDD

状态：`Approved for implementation / UI defect ISS-UI-005`

## 1. 问题

真实浏览器访问当前 Agent 服务的未知页面路径 `/ui-uat-404` 时，NestJS 直接返回 JSON：

```json
{"message":"Cannot GET /ui-uat-404","error":"Not Found","statusCode":404}
```

前端已经存在 React `*` 路由和中文“页面不存在”页面，但服务端只显式列举已知页面路径，导致
浏览器刷新未知路径时无法进入 React Router。

## 2. 目标

- 普通浏览器 GET 页面导航若没有匹配服务端路由，返回 `dist/agent-web/agent.html`，由 React
  Router 展示现有 404 页面。
- `/api`、`/webhooks`、`/internal` 下的请求继续由 NestJS 处理，未知路径保持服务端 404。
- 带文件扩展名的缺失静态资源不回退到 HTML，继续返回真实 404。
- 非 GET 请求和不接受 `text/html` 的客户端请求不进入 SPA fallback。

## 3. 设计

新增独立的 Agent Web fallback middleware 工厂，并在 `agent.main.ts` 中按以下顺序注册：

1. `express.static` 提供真实静态资源；
2. 注册有严格路径、方法和 Accept 过滤的 SPA fallback middleware；
3. `app.init()` 注册全部 NestJS controller；
4. `app.listen()` 启动服务。

fallback 必须位于 Nest 初始化之前；Nest 会在初始化末尾注册自己的 404 handler，后置 Express
middleware 无法接到未知路径。由于 fallback 显式排除了全部服务端顶级前缀，它提前注册也不会
吞掉 API、飞书回调或内部调度请求。

middleware 只有在以下条件全部成立时发送 `agent.html`：

- 方法为 `GET`；
- `Accept` 包含 `text/html`；
- 路径不属于 `/api`、`/webhooks`、`/internal` 本身或其子路径；
- 路径最后一段没有文件扩展名。

## 4. 安全边界

- 不改变登录、租户、角色或 API 鉴权。
- 不将 API 404 包装成 HTML，避免客户端把错误页面误当 JSON；这是允许 fallback 先于 Nest
  controller 注册的必要条件。
- 不吞掉飞书事件、卡片回调和内部调度入口。
- 不新增依赖，不改 `server/main.ts`，只作用于独立 Agent 运行时。

## 5. 验收

- 单元测试覆盖页面导航、服务端前缀、静态资源、方法和 Accept 头。
- TypeScript、ESLint、Agent/Web 构建通过。
- 重启 Agent 后，真实浏览器访问未知页面显示中文 404 页面并可返回工作台。
- 真实浏览器访问未知 `/api` 路径仍显示服务端 404 JSON。

