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

| 命令                  | 作用                                   |
| --------------------- | -------------------------------------- |
| `make bootstrap`      | 安装 pnpm 与 Go 依赖                   |
| `make dev`            | 启动数据库、迁移、API 与前端热更新     |
| `make generate`       | 生成 OpenAPI bundle、Go/TS API 与 sqlc |
| `make generate-check` | 验证生成物已提交且无漂移               |
| `make check`          | 运行前端与后端质量门禁                 |
| `make test`           | 运行前后端测试                         |
| `make e2e`            | 启动隔离全栈并运行真实 API Playwright  |
| `make build`          | 构建前端、后端及容器镜像               |
| `make compose-up`     | 启动生产形态 Compose                   |
| `make compose-down`   | 停止生产形态 Compose                   |

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

## 同源部署

根目录 `compose.yaml` 构建四个核心服务：

- `web`：Nginx 提供 SPA，并反向代理 `/api/` 和 `/files/`；
- `api`：Go 服务，仅在容器网络暴露；
- `migrate`：API 启动前执行 Goose migrations；
- `db`：PostgreSQL 持久卷。

`pgadmin` 仅通过 `--profile admin` 显式启用。生产环境只公开 Web 入口，TLS 在外层入口终止。前端固定以 `/api/` 访问业务 API。

## 文档

- [APP：访问、会话与权限](docs/domains/app.md)
- [BOB：基础业务对象](docs/domains/bob.md)
- [VOU：业务单据](docs/domains/vou.md)
- [WFL：业务流程](docs/domains/wfl.md)
- [LED：业务账簿](docs/domains/led.md)
- [迁移与上线切换](docs/operations/monorepo-cutover.md)

## 安全

- 本地环境文件、数据库、附件和测试凭证均被 Git 忽略。
- 所有浏览器会话使用 HttpOnly Cookie 与 CSRF Token；生产 Cookie 必须为 `Secure + SameSite=Lax + Path=/`。
- 后端鉴权是最终安全边界，前端权限只控制菜单和交互。
- 错误、日志和用户反馈不得包含凭证、Cookie、Token 或敏感业务数据。

## License

MIT，见 [LICENSE](LICENSE)。
