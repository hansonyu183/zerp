# ZERP Frontend

`frontend/` 是当前唯一 Vue SPA。它通过 `src/target/api.ts` 消费 `packages/api-client/` 从 Hono 路由推导的类型客户端，页面状态与动作位于同目录 `vm.ts`。

生产页面只从 `src/target/router/index.ts` 登记。ACC、DCL、VOU、WFL 与 RPT 均使用各页面 public VM；聚合 probe 与巨型共享 VM 已删除。动态 WFL/RPT 页面只接受契约限定的 code，并以服务器菜单目录和精确权限校验入口。

```bash
pnpm dev:target
pnpm typecheck
pnpm test:unit
pnpm build:target
```

完整 PostgreSQL 与浏览器验收从仓库根目录运行 `make e2e`。生产构建和 API 基址见[根 README](../README.md)与[前端 API 配置](../docs/operations/frontend-api-configuration.md)。
