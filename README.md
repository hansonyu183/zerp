# ZERP

ZERP 是一个面向企业内部业务的全栈 ERP 单仓项目。Vue 前端、Go API、数据库迁移、OpenAPI 契约、领域文档和部署编排均在本仓库统一维护。

## 目录

```text
frontend/             Vue 3、TypeScript、Vite、Vuetify
backend/              Go、Gin、pgx、sqlc、Goose
contracts/openapi/    唯一 HTTP 线协议与生成后的 bundle
docs/domains/         唯一业务规则与前后端职责说明
scripts/              联调、测试、预览与发布编排
tools/                独立版本的构建工具
.github/workflows/    全栈质量门禁
```

## 环境

- Node.js 26
- pnpm 10.34.5
- TypeScript 7.0.2
- Go 1.26.5
- Docker 与 Docker Compose
- GNU Make
- ShellCheck

## 快速开始

```bash
cp backend/.env.example backend/.env.local
make bootstrap
make dev
```

`make dev` 会启动 PostgreSQL 容器、执行迁移，并以前台热更新方式运行 Go API 和 Vite。浏览器访问 `http://127.0.0.1:5173`；Vite 将 `/api/*` 代理到 API 并去掉 `/api` 前缀，将 `/files/*` 直接代理到附件端点。

TypeScript 7 原生编译器由 `tools/typescript-native/` 独立锁定并参与前端构建。TypeScript 7.0 暂不提供 JavaScript API，因此 Vue 模板检查、ESLint 和 OpenAPI 类型生成继续使用兼容的 TypeScript 6 工具链；`pnpm typecheck:native` 会用 7.0.2 检查项目 TypeScript 源码。

停止前台进程后数据库卷会保留；需要停止容器时运行：

```bash
make dev-down
```

## 常用命令

| 命令                           | 作用                                   |
| ------------------------------ | -------------------------------------- |
| `make bootstrap`               | 安装 pnpm 与 Go 依赖                   |
| `make dev`                     | 启动数据库、迁移、API 与前端热更新     |
| `make generate`                | 生成 OpenAPI bundle、Go/TS API 与 sqlc |
| `make generate-check`          | 验证生成物已提交且无漂移               |
| `make check`                   | 运行前端与后端质量门禁                 |
| `make pre-push-plan`           | 显示当前提交将运行的分层门禁           |
| `make pre-push`                | 按变更影响运行分层推送前门禁           |
| `make test`                    | 运行前后端测试                         |
| `make e2e`                     | 启动隔离全栈并运行真实 API Playwright  |
| `make build`                   | 构建前端、后端及容器镜像               |
| `make compose-up`              | 启动生产形态 Compose                   |
| `make compose-down`            | 停止生产形态 Compose                   |
| `make preview-up`              | 以本机进程构建并启动固定开发预览       |
| `make preview-deploy`          | 从指定 commit 构建本机固定预览         |
| `make preview-down`            | 停止预览并保留人工测试数据             |
| `make preview-reset`           | 仅重置预览环境的数据与附件             |
| `make preview-rollback`        | 回退到上一版固定预览                   |
| `make preview-status`          | 检查预览进程、本机和公网版本           |
| `make preview-password`        | 仅把预览管理员密码复制到剪贴板         |
| `make preview-uninstall-agent` | 卸载旧版 `dev` 预览轮询代理            |
| `make production-status`       | 检查正式环境版本及本地/公网健康状态    |
| `make production-retry`        | 修复发布阻塞后重试被熔断的正式发布     |

## 契约工作流

`contracts/openapi/openapi.yaml` 及其引用文件是 HTTP 线协议的唯一来源。修改契约后运行：

```bash
make generate
```

生成物必须与契约源文件一同提交；形成可验收提交后运行 `make pre-push` 检查生成漂移和全栈行为。生成物包括：

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

前端也可由 Cloudflare Pages 托管并直连 HTTPS API。Pages Git 集成使用 `pnpm build` 和根目录 `dist/`，构建时写入精确 commit 标记；后端必须精确允许前端 Origin，并按实际站点拓扑配置 Cookie。两种方式的环境变量和验收步骤见前端 API 配置手册。

### 固定外网开发预览

人工验收使用本机 PostgreSQL、Go API 和静态 Web 进程，不依赖 Docker/Colima，并持久保留测试数据。桌面、手机和本机统一访问：

```text
https://zerp-preview.bytesucceed.com
```

首次运行 `make preview-up` 会生成权限为 `600` 的 `backend/.env.preview.local`、建立独立本机 PostgreSQL cluster、迁移数据库、初始化管理员，并按 AUX、BOB、VOU/WFL、LED 顺序补齐全业务测试数据。若检测到旧 Compose 预览，会先备份并一次性导入数据库与附件，再停止旧容器；该环境不复用 E2E 数据，也不会被 `make e2e` 清理。

临时检查可用 `make preview-up` 构建当前工作区。需要固定预览的 Ready PR，必须从 `HEAD == origin/main` 的受信任控制 checkout 使用准确 head SHA 执行 `make preview-deploy PREVIEW_PR=<number> PREVIEW_REF=<pr-head-full-sha>`，禁止在 PR worktree 运行预览控制命令；随后运行 `make preview-status` 和 `make preview-accept PREVIEW_PR=<number>`，验收人取当前 `gh` 登录身份。合并后的 `main` 由生产代理自动发布。完整生命周期、状态晋升、回退和验收方法见固定预览运维说明。

## 文档

- [APP：访问、会话与权限](docs/domains/app.md)
- [BOB：业务对象](docs/domains/bob.md)
- [AUX：辅助对象](docs/domains/aux.md)
- [VOU：业务单据](docs/domains/vou.md)
- [WFL：业务流程](docs/domains/wfl.md)
- [LED：业务账簿](docs/domains/led.md)
- [前端 API 与双部署配置](docs/operations/frontend-api-configuration.md)
- [固定外网开发预览](docs/operations/fixed-preview.md)
- [开发、PR 与自动上线规范](docs/operations/development-release.md)
- [测试与发布流程指标](docs/operations/release-metrics.md)

## 安全

- 本地环境文件、数据库、附件和测试凭证均被 Git 忽略。
- 所有浏览器会话使用 HttpOnly Cookie 与 CSRF Token；当前同站生产拓扑使用 `Secure + SameSite=Lax + Path=/`，真正跨站且必须携带 Cookie 时使用 `SameSite=None + Secure`。
- 后端鉴权是最终安全边界，前端权限只控制菜单和交互。
- 错误、日志和用户反馈不得包含凭证、Cookie、Token 或敏感业务数据。

## License

MIT，见 [LICENSE](LICENSE)。
