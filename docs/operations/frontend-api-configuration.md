# ZERP 前端 API 与部署配置

本文只说明环境拓扑、API 基址、Origin、Cookie 和联调步骤。HTTP 路径与数据结构以 `contracts/openapi/` 为准，业务规则以 `docs/domains/` 为准。

ZERP 正式支持同源 Web 和 Cloudflare Pages 两种前端部署，二者使用相同的生成客户端和后端 API。

## 1. 同源 Web

根目录 Compose 由 Nginx 提供 SPA，并代理：

```text
/api/*   -> API 业务端点，转发时去掉 /api 前缀
/files/* -> API 文件端点，保留 /files 前缀
```

前端构建参数：

```env
VITE_API_BASE_URL=/api/
```

浏览器只访问 Web Origin，不需要为 Web 与 API 配置跨域。生产环境应只公开 Web 入口，TLS 在外层入口终止。

验证配置和镜像：

```bash
docker compose --env-file backend/.env.example config --quiet
docker compose --env-file backend/.env.example build web api migrate
```

## 2. Cloudflare Pages

Pages 构建配置：

| 配置                   | 值           |
| ---------------------- | ------------ |
| Root directory         | `/`          |
| Build command          | `pnpm build` |
| Build output directory | `dist`       |

前端通过构建时变量直连目标 HTTPS API：

```env
VITE_API_BASE_URL=https://api.example.com/
```

`VITE_*` 会进入浏览器资源，只能保存公开配置。修改 Pages 环境变量后必须重新构建。

后端 `CORS_ALLOWED_ORIGINS` 必须列出完整前端 Origin，例如：

```text
https://erp.example.com
```

Origin 包含协议、主机和可选端口，不包含路径或结尾 `/`。不得使用通配符允许凭证请求；Pages 预览域名按需逐个加入并在联调结束后移除。

前端与 API 同为 `https://*.example.com` 时属于同站，可以使用 `SameSite=Lax`。真正跨站且必须携带 Cookie 时才使用 `SameSite=None`，并强制启用 `Secure`。

仓库当前 Pages 默认 API 见 `frontend/.env.production`；不同环境应通过 Pages 的 Preview 或 Production 变量显式覆盖。

## 3. 本地开发

推荐从仓库根目录启动：

```bash
make dev
```

浏览器访问 `http://127.0.0.1:5173`。Vite 使用同源 `/api/` 和 `/files/` 代理到本机 API，因此登录 Cookie 不依赖本地 CORS。

本机纯 HTTP Cookie 配置只写入被 Git 忽略的 `backend/.env.local`：

```env
APP_SESSION_COOKIE_SECURE=false
APP_SESSION_COOKIE_SAME_SITE=lax
```

如需让前端直接跨 Origin 请求本机 API，必须把实际前端 Origin 精确加入 `CORS_ALLOWED_ORIGINS`。协议、主机或端口任一变化都会产生不同 Origin。

Vite 必须使用固定端口，避免端口占用后自动切换到未配置的 Origin：

```bash
pnpm --filter @zerp/frontend dev --host 127.0.0.1 --port 5173 --strictPort
```

## 4. 隔离 E2E

BOB、VOU、WFL 和 ACC 流程会写入并流转真实数据，只能使用根目录自包含环境：

```bash
cp backend/.env.e2e.example backend/.env.e2e.local
make e2e
```

固定隔离边界：

| 资源              | 值                   |
| ----------------- | -------------------- |
| Compose 项目      | `zerp-fullstack-e2e` |
| PostgreSQL 数据库 | `zerp_e2e`           |
| PostgreSQL 端口   | `55435`              |
| API 端口          | `18081`              |
| Web 端口          | `15174`              |
| Cookie            | `zerp_e2e_session`   |
| GitHub 反馈发布   | 关闭                 |

根级脚本会向 Playwright 注入正确的 API、Web 和账号变量。不要在前端环境文件中长期复制密码或端口；不得把 E2E 指向生产或日常联调数据库。

完整验收统一从仓库根目录运行 `make e2e`。命令会创建一次性 PostgreSQL 容器，原生启动 API 和 Web，结束后自动清理隔离数据库与进程。

## 5. 联调验收

每个目标环境重新验证：

1. `/healthz` 与 `/readyz` 成功；
2. 浏览器使用预期 API 基址，没有把业务请求发往静态站点；
3. Pages 模式返回精确 Origin 和凭证 CORS，同源模式不产生跨域请求；
4. 登录写入 HttpOnly Cookie，生产带 `Secure`，SameSite 与站点拓扑一致；
5. 刷新后恢复会话和 CSRF，受保护请求成功；
6. 使用真实已注册业务动作验证目标版本，不以健康检查代替业务验收；
7. 注销后原会话不能继续调用受保护接口。

记录环境、提交、时间和必要的 `requestId`，不得记录密码、Cookie、CSRF Token 或敏感请求体。

接口操作、请求结构和错误包络直接查阅生成客户端或 OpenAPI；会话、权限和领域行为查阅对应领域文档。
