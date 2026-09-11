# ZERP Frontend

`frontend/` 是当前唯一 Vue SPA。它通过 `src/target/api.ts` 消费 `packages/api-client/` 从 Hono 路由推导的类型客户端，全部已登记业务资源在 `src/target/definitions/` 声明字段与无状态类型化 API 适配，状态与动作由直接维护、版本档案、单据、配置、报表和流程运行六类公共页面运行时持有，见 [ADR-0060](../docs/adr/0060-dynamic-page-runtime.md)。

`src/target/router/index.ts` 装配会话页与唯一业务 ResourceHost；导航只由当前 Session 的非 Session `apiPaths` 按资源去重、按领域分组。Host 先检查同一资源权限，再从 `src/target/navigation/registry.ts` 取得业务实现。Registry 中十二个 APP/AUX 直接维护资源统一进入 DirectPage，其他业务资源按 definition 类型进入对应公共页面运行时；其他已授权但未登记的资源明确显示未实现，不发查询或回退其他页面。

AppLayout、Vuetify 主题和公共反馈保持既有风格。`ManagementPageFrame` 用于当前 Host；`ListPageShell` 承载统一列表布局与交互，DirectPage 内部复用它并承载动态编辑表单、引用选择与写入状态管理。

```bash
pnpm dev:target
pnpm typecheck
pnpm check:architecture
pnpm test:pure
pnpm test:component
pnpm build:target
```

`pnpm test:unit` 仍执行全部普通与 Vuetify 测试；源码边界及部署配置检查在 `pnpm check:architecture` 的 Node 环境运行，三个配置互不重复。

完整 PostgreSQL 与浏览器验收从仓库根目录运行 `make e2e`。生产构建和 API 基址见[根 README](../README.md)与[前端 API 配置](../docs/operations/frontend-api-configuration.md)。
