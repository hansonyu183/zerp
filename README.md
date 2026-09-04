# ZERP

ZERP 是一个面向企业内部业务的全栈 ERP 单仓项目。Vue 前端、live Go API、当前数据库基线、live OpenAPI 契约、领域文档和部署编排均在本仓库统一维护；#366 前的 Hono/共享 TypeScript target 只在隔离拓扑中验证。

## 目录

```text
frontend/             Vue 3、TypeScript、Vite、Vuetify
backend/              Go、Gin、pgx、sqlc
apps/api/             隔离 target Hono/Kysely API
packages/             隔离 target 共享模型、客户端与 WFL 运行时
contracts/openapi/    #366 前唯一 live HTTP 线协议与生成后的 bundle
docs/domains/         唯一业务规则与领域职责说明
docs/use-cases/       按页面组织的前后端处理流程与验收场景
scripts/              联调与测试工具
backend/tools/        独立版本的构建工具
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

`make dev` 会启动按当前 `backend/db/schema.sql` 初始化的 PostgreSQL 容器，并以前台热更新方式运行 Go API 和 Vite。浏览器访问 `http://127.0.0.1:5173`；Vite 将 `/api/*` 代理到 API 并去掉 `/api` 前缀，将 `/files/*` 直接代理到附件端点。

停止前台进程后数据库卷会保留；需要停止容器时运行：

```bash
make dev-down
```

## 常用命令

| 命令                                     | 作用                                                    |
| ---------------------------------------- | ------------------------------------------------------- |
| `make bootstrap`                         | 安装 pnpm 与 Go 依赖                                    |
| `make dev`                               | 启动数据库、API 与前端热更新                            |
| `make generate`                          | 生成 OpenAPI bundle、Go/TS API 与 sqlc                  |
| `make generate-check`                    | 验证生成物已提交且无漂移                                |
| `make check`                             | 运行文档及 live 契约、生成物、前后端和运行配置门禁      |
| `make test`                              | 运行前后端测试                                          |
| `make e2e`                               | 启动隔离全栈并运行真实 API Playwright                   |
| `make build`                             | 构建前端、后端及 API 容器镜像                           |
| `make -C backend rpt-validate-published` | 校验全部启用的 latest `APPROVED + VALID` RPT definition |
| `make compose-up`                        | 校验已发布 RPT definition 后启动生产形态 Compose        |
| `make compose-down`                      | 停止生产形态 Compose                                    |

`pnpm --filter @zerp/frontend typecheck` 是唯一生产前端类型门禁，只运行一次 `vue-tsc -b --force`。`pnpm --filter @zerp/frontend test:vue-template-typecheck` 是独立工具链回归测试：它要求同一 checker 拒绝故意错误的隔离 Vue template fixture，并由 `make check` 自动运行；该 canary 不属于生产 `typecheck` 命令。

## 隔离 target 验证

#366 前，target frontend、Hono API、共享 TypeScript model、target schema、target OpenAPI 和 target 权限目录只在 `compose.target.yaml` 的隔离环境运行，不代理或接收 live Go 流量，也不与 live 数据库共同写入。

| 命令                         | 作用                                                  |
| ---------------------------- | ----------------------------------------------------- |
| `make target-generate-check` | 重新生成并检查 target OpenAPI、权限目录和 Kysely 类型 |
| `make target-check`          | 运行 target 生成检查、WFL parity 与静态检查           |
| `make target-test`           | 运行 target 检查和 API 测试                           |
| `make target-e2e`            | 构建隔离 target 并运行真实 PostgreSQL/浏览器 E2E      |
| `make target-down`           | 删除本机 target Compose 容器和卷                      |

默认隔离资源是数据库 `zerp_target_test`、PostgreSQL `55439`、API `18082` 和 Web `18083`；可通过同名 `TARGET_*` Make 变量覆盖。`target-generate-check`、`target-check`、`target-test` 和 `target-e2e` 都会先删除并重建 `zerp-target` Compose 的数据库容器及可丢弃卷，不得把这些变量指向共享或真实业务库。这些命令会保留已启动的 target 资源供检查，结束后应显式运行 `make target-down`。CI 将这条链路作为独立的 `target-foundation` job 运行，当前 `make check` 与 `make e2e` 仍验证 live Go 栈。

## 契约开发

`contracts/openapi/openapi.yaml` 及其引用文件是 #366 前 live Go HTTP 线协议的唯一来源。修改 live 契约后运行：

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

ZERP 前端仅通过 Cloudflare Pages 部署。API 基址、Origin、Cookie、联调和验收步骤统一见[前端 API 配置](docs/operations/frontend-api-configuration.md)。

生产形态 Compose 在数据库健康后先运行一次 `zerp-rpt-validate-published`，只有全部启用 definition 的 latest `APPROVED + VALID` 版本均通过当前数据库基线校验后才启动 API。需要独立预检时，使用 `make -C backend rpt-validate-published`；任一无法通过校验的 definition 会返回非零状态并输出其 stable code、definition ID 与 Approval Entry ID。

## 文档

版本化申报统一从 DCL 写入：DCL subject 保存 stable ID、code 与创建审计，中央 Approval 只提供版本头、状态与审计；BOB 只读 typed latest-approved snapshot，RPT 只拥有有效性、执行与运行审计，WFL 保留既有 current 开关，AUX 使用无审批的 Stable-ID Direct CRUD；权威边界见 [ADR-0047](docs/adr/0047-dcl-subject-is-the-stable-identity-authority.md)。

- [共享术语与权威链接](CONTEXT.md)
- [Approval：中央审批与版本](docs/domains/approval.md)
- [DCL：申报控制](docs/domains/dcl.md)
- [APP：访问、会话与权限](docs/domains/app.md)
- [BOB：业务对象](docs/domains/bob.md)
- [AUX：辅助对象](docs/domains/aux.md)
- [VOU：业务单据](docs/domains/vou.md)
- [WFL：业务流程](docs/domains/wfl.md)
- [ACC：内部会计](docs/domains/acc.md)
- [RPT：报表](docs/domains/rpt.md)
- [架构决策记录](docs/adr/README.md)
- [ADR-0050：数据库只负责持久化](docs/adr/0050-database-only-persists-facts.md)
- [页面用例索引](docs/use-cases/README.md)
- [前端 API 配置](docs/operations/frontend-api-configuration.md)
- [测试与验收证据](docs/testing/README.md)

安全开发约束见 [AGENTS.md](AGENTS.md)，部署安全配置见[运行手册](docs/operations/frontend-api-configuration.md)。

## License

MIT，见 [LICENSE](LICENSE)。
