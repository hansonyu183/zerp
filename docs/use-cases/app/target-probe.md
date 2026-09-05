# ZERP 入口页面用例

## 范围

- 构建入口：`frontend/index.html`；生产镜像与 Cloudflare Pages 都将它作为站点根页面提供。
- 通用认证与授权规则见 [APP 领域](../../domains/app.md)，本地 Draft、Submission、Hono 契约与切换边界见 [ADR-0051](../../adr/0051-shared-typescript-model-local-drafts-and-hono-cutover.md)。
- HTTP 类型由 `frontend/src/target/api.ts` 从可执行 Hono 路由推导。

## `TGT-01` 打开入口

1. 浏览器加载 `index.html` 并由 `frontend/src/target/main.ts` 挂载应用。
2. 未登录时显示登录表单；认证成功后按当前路径和服务端返回的精确权限展示对应业务面板。
3. 请求失败时保留当前本地输入，显示稳定业务说明以及可用的 `requestId`；不得用假数据兜底。

## 验收

1. 文档覆盖门禁将入口映射到本用例。
2. target build 和 E2E 从该入口加载应用；请求只到 Hono API。
3. 缺少页面用例映射、入口模块或标题时，`pnpm docs:check` 必须失败。
