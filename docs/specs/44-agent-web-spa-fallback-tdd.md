# Agent Web SPA 未知路由回退 TDD

状态：`Green / UI Verified 2026-10-16`

## Red

- `GET /ui-uat-404` + `Accept: text/html` 应进入 SPA fallback。
- 已知或未知的 `/api`、`/webhooks`、`/internal` 路径不得进入 fallback。
- 缺失 `.js` / `.css` 等静态资源不得进入 fallback。
- 非 GET 或不接受 HTML 的请求不得进入 fallback。
- middleware 仅在命中规则时调用 `sendFile`，否则调用 `next`。

## Green

- 新增纯判定函数和 Express middleware 工厂。
- 在静态资源之后、Nest 路由初始化之前注册 middleware。第一次后置注册虽然单测 Green，但真实
  UI 仍由 Nest 404 handler 提前结束请求，已作为失败路径记录并纠正挂载顺序。

## Refactor / Regression

- 保持服务端路径前缀为单一常量来源。
- 运行定向测试、三套类型检查、ESLint、Agent/Web 构建。
- 用真实浏览器复测页面 404 与 API 404 两条路径。

## 结果

- Red：定向测试因 `@server/config/agent-web-spa-fallback` 不存在而失败。
- Green：定向 `1 file / 11 tests` 通过；服务端和测试 TypeScript、相关 ESLint、Agent/Web
  构建通过。
- 第一次 UI 回归暴露后置 middleware 无法越过 Nest 404 handler；调整挂载顺序后第二次 UI
  回归通过。
- 最终页面证据：`/ui-uat-404` 显示“页面不存在 / 返回工作台”；
  `/api/ui-uat-404` 保持服务端 JSON 404。

