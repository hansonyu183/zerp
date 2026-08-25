# ZERP

ZERP 是一个面向企业内部业务的全栈 ERP 单仓项目。Vue 前端、Go API、数据库迁移、OpenAPI 契约、领域文档和部署编排均在本仓库统一维护。

## 目录

```text
frontend/             Vue 3、TypeScript、Vite、Vuetify
backend/              Go、Gin、pgx、sqlc、Goose
contracts/openapi/    唯一 HTTP 线协议与生成后的 bundle
docs/domains/         唯一业务规则与领域职责说明
docs/use-cases/       按页面组织的前后端处理流程与验收场景
scripts/              联调与测试工具
tools/                独立版本的构建工具
```

## 环境

- Node.js 26
- pnpm 10.34.5
- TypeScript 7.0.2
- Go 1.26.6
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

前端构建、类型检查及相关工具统一使用 TypeScript 7.0.2 的 tsgo checker。仓库通过锁定的 TypeScript native bridge 让 `vue-tsc` 使用同一 checker 检查 TypeScript 与 Vue SFC template，不维护第二套 TypeScript 兼容工具链。native bridge 需要 glibc，因此前端 Docker 构建阶段使用 Debian，最终 Nginx 运行镜像仍使用 Alpine。

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
| `make check`          | 运行前端与后端质量检查                 |
| `make test`           | 运行前后端测试                         |
| `make e2e`            | 启动隔离全栈并运行真实 API Playwright  |
| `make build`          | 构建前端、后端及容器镜像               |
| `make compose-up`     | 启动生产形态 Compose                   |
| `make compose-down`   | 停止生产形态 Compose                   |

`pnpm --filter @zerp/frontend typecheck` 是唯一生产前端类型门禁，只运行一次 `vue-tsc -b --force`。`pnpm --filter @zerp/frontend test:vue-template-typecheck` 是独立工具链回归测试：它要求同一 checker 拒绝故意错误的隔离 Vue template fixture，并由 `make check` 自动运行；该 canary 不属于生产 `typecheck` 命令。

## 契约开发

`contracts/openapi/openapi.yaml` 及其引用文件是 HTTP 线协议的唯一来源。修改契约后运行：

```bash
make generate
```

需要纳入版本控制的生成物必须与契约源文件一同提交；使用 `make generate-check` 检查生成漂移。需提交的生成物包括：

- `backend/internal/api/generated/server.gen.go`
- `frontend/src/api/generated/schema.ts`
- `backend/internal/database/sqlc/`

`make generate` 还会在 `contracts/openapi/dist/openapi.json` 生成被 Git 忽略的临时 bundle，供后续生成步骤使用；该文件不提交。前端模型由不依赖 TypeScript 编译器 API 的 OpenAPI 生成器产生，并由仓库脚本补充 `openapi-fetch` 所需的路径类型，因此工具链只使用 TypeScript 7/tsgo checker；native bridge 仅提供 Vue language tools 所需的经典 API 表面，不引入第二个 checker。

业务代码不得手改生成物。前端页面只依赖生成 DTO 或 UI 自有模型；后端在 Handler 边界把生成 DTO 映射到领域类型。

## 部署方式

ZERP 正式支持同源 Web 和 Cloudflare Pages 两种前端部署。拓扑、API 基址、Origin、Cookie、联调和验收步骤统一见[前端 API 与双部署配置](docs/operations/frontend-api-configuration.md)。

## 文档

- [Approval：中央审批](docs/domains/approval.md)
- [APP：访问、会话与权限](docs/domains/app.md)
- [BOB：业务对象](docs/domains/bob.md)
- [AUX：辅助对象](docs/domains/aux.md)
- [VOU：业务单据](docs/domains/vou.md)
- [WFL：业务流程](docs/domains/wfl.md)
- [ACC：内部会计](docs/domains/acc.md)
- [RPT：报表](docs/domains/rpt.md)
- [页面用例索引](docs/use-cases/README.md)
- [前端 API 与双部署配置](docs/operations/frontend-api-configuration.md)

安全开发约束见 [AGENTS.md](AGENTS.md)，部署安全配置见[运行手册](docs/operations/frontend-api-configuration.md)。

## License

MIT，见 [LICENSE](LICENSE)。
