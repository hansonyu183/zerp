# ZERP Frontend

`frontend/` 是当前唯一 Vue SPA。它通过 `src/target/api.ts` 消费 `packages/api-client/` 从 Hono 路由推导的类型客户端，直接维护资源在 `src/target/definitions/` 声明字段与类型化 API 适配，状态与动作由公共 DirectPage 运行时持有；其他页面状态与动作位于同目录 `vm.ts`。

`src/target/router/index.ts` 装配会话页与唯一业务 ResourceHost；导航只由当前 Session 的非 Session `apiPaths` 按资源去重、按领域分组。Host 先检查同一资源权限，再从 `src/target/navigation/registry.ts` 取得业务实现。Registry 中十二个 APP/AUX 直接维护资源统一进入 DirectPage，其他业务资源使用各自登记的实现；其他已授权但未登记的资源明确显示未实现，不发查询或回退其他页面。

AppLayout、Vuetify 主题和公共反馈保持既有风格。`ManagementPageFrame` 用于当前 Host；`ListPageShell` 承载统一列表布局与交互，DirectPage 内部复用它并承载动态编辑表单、引用选择与写入状态管理。

```bash
pnpm dev:target
pnpm typecheck
pnpm test:unit
pnpm build:target
```

完整 PostgreSQL 与浏览器验收从仓库根目录运行 `make e2e`。生产构建和 API 基址见[根 README](../README.md)与[前端 API 配置](../docs/operations/frontend-api-configuration.md)。
