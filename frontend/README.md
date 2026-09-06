# ZERP Frontend

`frontend/` 是当前唯一 Vue SPA。它通过 `src/target/api.ts` 消费 `packages/api-client/` 从 Hono 路由推导的类型客户端，页面状态与动作位于同目录 `vm.ts`。

`src/target/router/index.ts` 装配会话页与唯一业务 ResourceHost；导航只由当前 Session 的非 Session `apiPaths` 按资源去重、按领域分组。Host 先检查同一资源权限，再从 `src/target/navigation/registry.ts` 取得业务实现。Registry 当前登记 `app/user` 的真实列表和编辑流程；其他已授权但未登记的资源明确显示未实现，不发查询或回退其他页面。

AppLayout、Vuetify 主题和公共反馈保持既有风格。`ManagementPageFrame` 用于当前 Host；`ListPageShell` 承载统一列表布局与交互，`app/user` 已通过 Registry 接入真实查询和编辑流程。

```bash
pnpm dev:target
pnpm typecheck
pnpm test:unit
pnpm build:target
```

完整 PostgreSQL 与浏览器验收从仓库根目录运行 `make e2e`。生产构建和 API 基址见[根 README](../README.md)与[前端 API 配置](../docs/operations/frontend-api-configuration.md)。
