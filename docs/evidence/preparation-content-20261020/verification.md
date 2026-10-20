# 准备包内容、独立入口与测试类型验证

日期：2026-10-20。Goal v1 仍为 blocked，整体未完成。本归档区分自动化验证、合成组件预览和真实身份验收；本轮没有新增真实飞书消息、Base 写入或任务创建。

## 本轮 PREP-TEST-TYPES

原测试配置继承 `tsconfig.node.json` 的 `**/*.spec.ts` 排除项，`include` 没有覆盖继承的排除规则。历史测试类型命令成功不能证明 spec 获得类型检查。

1. 新增 `tests/unit/test-type-coverage.spec.ts`，读取 TypeScript 解析后的项目文件集合，与 `tests/**/*.ts` 比较；修复前失败并列出 124 个被遗漏的 spec。
2. `tsconfig.test.json` 显式覆盖 exclude，配置匹配 Vitest/Vite 的 ESM、Bundler、JSX 和现有路径别名，包含 Vite/Vitest 配置；ESLint 使用同一测试项目。
3. 修复由真实类型检查揭示的测试夹具、缺失导入、SDK mock 参数及不完整鉴权审计替身；保留生产接口约束。未新增 any、类型忽略或排除失败测试。

| 验证 | 本轮结果 | 范围 |
| --- | --- | --- |
| `npm run type:check:test` | 退出码 0 | 修复后的测试项目 |
| TypeScript 项目文件清点 | 136 个测试源文件、124 个 unit spec，遗漏 0，配置诊断 0 | 含集成源文件及夹具；不等于执行集成测试 |
| `npm run test:agent` | 124 文件、1052 项通过，退出码 0 | 含新增类型覆盖回归及 HTTP 16 项；12:45:14 开始，约 16 秒 |
| `npx eslint <本轮文件> --quiet` | 退出码 0 | 22 个测试/夹具文件及 `vite.agent.config.ts`、`vitest.config.ts`、`vitest.integration.config.ts` |

初次实际类型检查诊断日志保留于系统 Temp 的 `sales-prep-test-types-20261020.log`。最终绿色结果来自本轮命令输出。单元日志中的注入失败用于验证失败路径，完整测试汇总为全部通过；仍有 Vite 配置原生加载兼容性告警。

`node --check eslint.config.js` 通过，本轮八份进展/设计文档与本证据文件未发现行末空格。工作区 `git diff --check` 仍报告既有的 `client/src/api/index.ts:647` 和 `client/src/app.tsx:61` 文件尾空行；本轮未改动这两处，不将工作区整体空白检查记为通过。

## 同日前序验证

- 隔离 PostgreSQL 17.7 UTF8 集群：55 项集成通过，3 项未开启的真实知识问答探针跳过；其中准备会话 10 项，覆盖 JSONB 完整往返、原报告不可变、编辑及租户/本人隔离。临时集群验证后已停止，未使用 `.env.local` 数据库。
- 服务端/客户端类型、目标生产 ESLint、Agent 188 文件构建、Web 3041 模块构建通过。本轮只修测试及验证配置，未重跑这些检查。
- 独立 Vite HTTP 导航回归先红 4 失败/12 通过，修复后 16/16；覆盖根路径、查询参数、结果深链、原入口及接口/资源/非导航排除。

## 截图来源与范围

截图由同日前序 Codex 内置浏览器留存，本轮复核归档；未补做已登录业务验收。组件预览使用合成测试夹具，页面明确标注为本地合成样例；没有把样例数据注入实际业务接口。

| 文件 | 内容 | 能证明的范围 |
| --- | --- | --- |
| [context-desktop.jpg](context-desktop.jpg) | 1366x900 桌面视口，整页截图 | 客户近况、商机判断/证据、最近跟进、议程及历史快照提示 |
| [context-mobile.jpg](context-mobile.jpg) | 390x844 移动视口，合成组件 | 长商机名、风险待核实、来源缺失与窄屏换行 |
| [context-mobile-history.jpg](context-mobile-history.jpg) | 移动端下半页 | 跟进、议程及历史快照缺失提示 |
| [identity-blocked.jpg](identity-blocked.jpg) | 未登录入口 | 身份验证提示能正常显示 |
| [entry-root.jpg](entry-root.jpg) | 修复后的根路径 | 正确加载 Agent 身份入口 |
| [entry-deep-link.jpg](entry-deep-link.jpg) | `/preparations/result-id?from=chat` 刷新 | 结果深链到达身份提示；参数保留由前序浏览器地址检查确认，截图本身不含地址栏 |

这些截图不证明有效账号下的结果读取、持久保存、409/失败恢复、人工核查或真实聊天闭环通过。

## 运行日志与剩余限制

本轮复核 `logs/agent-runtime.stderr.log`，遗留进程 PID 16228 持续报告 `Stale action recovery failed: connect ECONNREFUSED 127.0.0.1:55432`。当前后端不能视作健康；未启动数据库、重启该进程或触发恢复任务。

独立 Vite 日志保留修复前 12:16/12:17 的错误入口预转换失败；后续记录还有已有的 ESM 配置及 PostCSS `from` 告警。不能用构建成功推断整个运行环境无错误。

下一步 Todo：恢复关闭真实发送/业务写入的本地验收环境；补持久保存及冲突/失败保留输入；接 unknown -> sent 人工核查 UI；用有效飞书身份完成结果/编辑/恢复验收。`coding-guide` 要求表单开发前调用 `/forms-skill`，当前缺失且替代方式已在前序询问，相应表单暂缓。真实发送及业务写入仍受既有单独确认和额度约束。
