# 隔离 target 验证入口页面用例

## 范围

- 入口：`/target.html`。
- 当前状态：仅服务 #366 前的隔离 target 验证，不是 live 导航、生产入口或切流代理。
- 通用认证与授权规则见 [APP 领域](../../domains/app.md)，本地 Draft、Submission、Hono 契约与切换边界见 [ADR-0051](../../adr/0051-shared-typescript-model-local-drafts-and-hono-cutover.md)。各业务面板继续引用并遵循对应领域及页面用例，不在本页复制业务规则。
- target HTTP 类型由 `frontend/src/target/api.ts` 从可执行 Hono 路由推导；页面不得调用或代理 live Go API。

## `TGT-01` 打开隔离验证入口

1. 浏览器从 `target.html` 加载 `frontend/src/target/main.ts` 并挂载 target probe。
2. 未登录时只显示 target 登录表单；认证成功后按当前路径和服务端返回的精确权限展示对应验证面板。
3. 请求失败时保留当前本地输入，显示稳定业务说明以及可用的 `requestId`；不得用假数据或 live 响应兜底。

## `TGT-02` 验证业务面板

1. DCL、VOU、ACC 与 WFL 路径复用同一 target 入口，但只展示当前路径对应的业务面板；业务动作与验收场景以各自领域文档和页面用例为准。
2. 浏览器本地 Draft 只用于 target 交互验证，服务器结果必须来自 target Hono API。
3. target 入口不得出现在 live 菜单、live router 或生产 Pages 构建中；#366 切换前也不得把 target 权限目录与 live 权限目录组合。

## 验收

1. 文档覆盖门禁把 `/target.html` 识别为独立页面入口并映射到本用例。
2. target build 和 E2E 从该入口加载 probe；请求只到隔离 target API。
3. 缺少页面用例映射、入口模块或标题时，`pnpm docs:check` 必须失败。
