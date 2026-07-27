# ZERP

ZERP 是一个面向企业内部业务的全栈 ERP 单仓项目。Vue 前端、Go API、数据库迁移、OpenAPI 契约、领域文档和部署编排均在本仓库统一维护。

## 目录

```text
frontend/             Vue 3、TypeScript、Vite、Vuetify
backend/              Go、Gin、pgx、sqlc、Goose
contracts/openapi/    唯一 HTTP 线协议与生成后的 bundle
docs/domains/         唯一业务规则与前后端职责说明
scripts/              联调和自包含 E2E 编排
.github/workflows/    全栈质量门禁
```

## 环境

- Node.js 26
- pnpm 10.34.5
- Go 1.26.5
- Docker 与 Docker Compose
- GNU Make

## 快速开始

```bash
cp backend/.env.example backend/.env.local
make bootstrap
make dev
```

`make dev` 会启动 PostgreSQL 容器、执行迁移，并以前台热更新方式运行 Go API 和 Vite。浏览器访问 `http://127.0.0.1:5173`；Vite 将 `/api/*` 代理到 API 并去掉 `/api` 前缀，将 `/files/*` 直接代理到附件端点。

停止前台进程后数据库卷会保留；需要停止容器时运行：

```bash
make dev-down
```

## 常用命令

| 命令                    | 作用                                   |
| ----------------------- | -------------------------------------- |
| `make bootstrap`        | 安装 pnpm 与 Go 依赖                   |
| `make dev`              | 启动数据库、迁移、API 与前端热更新     |
| `make generate`         | 生成 OpenAPI bundle、Go/TS API 与 sqlc |
| `make generate-check`   | 验证生成物已提交且无漂移               |
| `make check`            | 运行前端与后端质量门禁                 |
| `make pre-push`         | 运行推送前门禁，代码变更包含隔离 E2E   |
| `make test`             | 运行前后端测试                         |
| `make e2e`              | 启动隔离全栈并运行真实 API Playwright  |
| `make build`            | 构建前端、后端及容器镜像               |
| `make compose-up`       | 启动生产形态 Compose                   |
| `make compose-down`     | 停止生产形态 Compose                   |
| `make preview-up`       | 构建并启动固定外网开发预览             |
| `make preview-deploy`   | 从指定 commit 构建固定预览             |
| `make preview-down`     | 停止预览并保留人工测试数据             |
| `make preview-reset`    | 仅重置预览环境的数据与附件             |
| `make preview-status`   | 检查预览容器、本机和公网健康状态       |
| `make preview-password` | 仅把预览管理员密码复制到剪贴板         |
| `make production-status` | 检查正式环境版本及本地/公网健康状态   |

## 契约工作流

`contracts/openapi/openapi.yaml` 及其引用文件是 HTTP 线协议的唯一来源。修改契约后必须运行：

```bash
make generate
git diff --exit-code
```

生成物包括：

- `contracts/openapi/dist/openapi.yaml`
- `backend/internal/api/generated/server.gen.go`
- `frontend/src/api/generated/schema.ts`
- `backend/internal/database/sqlc/`

业务代码不得手改生成物。前端页面只依赖生成 DTO 或 UI 自有模型；后端在 Handler 边界把生成 DTO 映射到领域类型。

## 部署方式

仓库正式支持两种部署方式，二者共享同一套 OpenAPI、领域规则和生成客户端。

### 同源 Web

根目录 `compose.yaml` 构建四个核心服务：

- `web`：Nginx 提供 SPA，并反向代理 `/api/` 和 `/files/`；
- `api`：Go 服务，仅在容器网络暴露；
- `migrate`：API 启动前执行 Goose migrations；
- `db`：PostgreSQL 持久卷。

`pgadmin` 仅通过 `--profile admin` 显式启用。该方式只公开 Web 入口，TLS 在外层入口终止，前端以 `/api/` 访问业务 API。

### Cloudflare Pages

前端也可由 Cloudflare Pages 托管并直连 HTTPS API。Pages 构建使用 `pnpm build:web` 和 `frontend/dist`；后端必须精确允许前端 Origin，并按实际站点拓扑配置 Cookie。两种方式的环境变量和验收步骤见前端 API 配置手册。

### 固定外网开发预览

人工验收使用独立 Compose 项目 `zerp-fullstack-preview`，构建当前工作区代码并持久保留测试数据。桌面、手机和本机统一访问：

```text
https://zerp-preview.bytesucceed.com
```

首次运行 `make preview-up` 会生成权限为 `600` 的 `backend/.env.preview.local`、随机初始化密码、迁移数据库并初始化管理员和 BOB 演示数据。该环境不复用 E2E 数据，也不会被 `make e2e` 清理。完整生命周期、Cloudflare Tunnel 配置和验收方法见固定预览运维说明。

可验收提交通过本地门禁后，使用 `make preview-deploy PREVIEW_REF=<commit>` 从隔离工作树更新固定预览。推送、PR 门禁、合并与自动上线规则见开发与发布规范。

## 文档

- [APP：访问、会话与权限](docs/domains/app.md)
- [BOB：基础业务对象](docs/domains/bob.md)
- [VOU：业务单据](docs/domains/vou.md)
- [WFL：业务流程](docs/domains/wfl.md)
- [LED：业务账簿](docs/domains/led.md)
- [前端 API 与双部署配置](docs/operations/frontend-api-configuration.md)
- [固定外网开发预览](docs/operations/fixed-preview.md)
- [开发、PR 与自动上线规范](docs/operations/development-release.md)
- [迁移与上线切换](docs/operations/monorepo-cutover.md)

## 安全

- 本地环境文件、数据库、附件和测试凭证均被 Git 忽略。
- 所有浏览器会话使用 HttpOnly Cookie 与 CSRF Token；生产 Cookie 必须为 `Secure + SameSite=Lax + Path=/`。
- 后端鉴权是最终安全边界，前端权限只控制菜单和交互。
- 错误、日志和用户反馈不得包含凭证、Cookie、Token 或敏感业务数据。

## License

MIT，见 [LICENSE](LICENSE)。
