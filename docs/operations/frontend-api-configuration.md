# ZERP 前端 API 配置

生产 HTTP 契约从 `apps/api/` 的可执行 Hono/Zod 路由生成，SPA 通过生成客户端直连 Hono API。

## 生产

API 使用 `compose.yaml` 与 `compose.production.yaml` 发布；前端可从同一 SHA 的 Web 镜像验收，并将同一构建产物发布到 Cloudflare Pages。生产变量模板见根目录 [`.env.production.example`](../../.env.production.example)。

Web 构建变量：

```env
TARGET_API_BROWSER_URL=https://zerp-api.bytesucceed.com
```

它会写入公开的 `VITE_TARGET_API_BASE_URL`。API 的 `CORS_ALLOWED_ORIGINS` 必须精确列出前端 Origin，不使用通配符。前端与 API 同站时使用 `SameSite=Lax`；真正跨站时才使用 `SameSite=None`，并同时启用 `Secure`。

API 连接非测试数据库时必须显式设置 `TARGET_DATABASE_SCOPE=production`。隔离测试默认只接受以 `_test` 结尾的数据库。

## 本地开发与验收

```bash
make dev
make e2e
make target-down
```

`make dev` 使用 `compose.target.yaml` 的固定隔离资源：数据库 `zerp_target_test`、PostgreSQL `55439`、API `18082`、Web `18083`。`make e2e` 每次删除并重建这些资源，运行生成、WFL parity、API 单元/集成测试和 Playwright。不得把 `TARGET_*` 变量指向共享或公网数据库。

## 发布验收

1. `/healthz` 与 `/readyz` 成功；
2. API 与 Web 的 `_zerp-release` 对应同一完整合并 SHA；
3. 浏览器请求发往预期 HTTPS API，CORS 返回精确 Origin；
4. 登录写入 HttpOnly、Secure Cookie，刷新后会话与 CSRF 恢复；
5. 使用真实权限验证 APP Workbench 和代表性 DCL、VOU、ACC、WFL、RPT 流程；
6. 注销后原会话不可继续访问受保护接口。

记录环境、提交、时间和必要的 `requestId`，不记录密码、Cookie、CSRF Token 或敏感请求体。
