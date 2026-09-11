# ZERP

ZERP 是一个面向企业内部业务的全栈 ERP 单仓项目。生产实现只有一套：Vue SPA、Hono/Kysely API、共享 TypeScript model、PostgreSQL 基线和由可执行 Hono/Zod 路由生成的 HTTP 契约。

## 目录

```text
frontend/             Vue 3 target SPA
apps/api/             Hono/Kysely API、路由与数据库基线
packages/             共享模型、类型客户端与 WFL 运行时
docs/domains/         权威业务规则
docs/use-cases/       页面编排与验收场景
```

## 环境与常用命令

- Node.js 26、pnpm 10.34.5、TypeScript 7.0.2
- Go 1.26.6 仅用于构建 WFL Starlark WASM 运行时及 parity 验证
- Docker、Docker Compose、GNU Make

```bash
make bootstrap
make dev
make check-static
make test-unit
make test-component
make generate-check
make e2e
make target-down
```

`make dev` 启动可丢弃 target 数据库与 Hono API，再以前台 Vite 启动 SPA。`make generate` 从 Hono/Zod 路由和 target schema 生成 OpenAPI、权限目录与 Kysely 类型；`packages/api-client/` 在编译期直接从同一 Hono route type 推导客户端类型。生成物不得手工修改。

| 命令                    | 职责与前置                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `make check-static`     | 格式、文档、当前架构、生成工具测试、全包类型与前端 lint；只需安装依赖，不生成、不启动 Compose 或浏览器。                                                           |
| `make check`            | 静态检查加 CI 配置与分类/汇总行为测试。                                                                                                                            |
| `make test-unit`        | model/API 单测与前端纯计算、分页、序列化、状态决策测试；不准备数据库或 WASM。                                                                                      |
| `make test-component`   | 普通组件交互与真实 Vuetify 组件；AppLayout 仅进入普通配置。                                                                                                        |
| `make test`             | 单元加组件测试。                                                                                                                                                   |
| `make test-integration` | 真实 PostgreSQL 集成；必须显式提供独占可丢弃的 `TARGET_TEST_DATABASE_URL`，库名以 `_test` 结尾，且已应用当前 schema、同步目录、构建 WFL WASM。该入口不重建数据库。 |
| `make generate-check`   | 生成业务契约、重建 target 数据库并生成数据库类型，再复用统一差异检查器。                                                                                           |
| `make e2e`              | 完整验收：公共/CI 检查、生成物、静态、单元、组件、编排 CLI、真实 PostgreSQL、WFL Node/browser parity、Compose 构建与五组串行浏览器验收；任一必需阶段失败即退出。   |

例如，确认没有其他任务占用 `zerp-target` 后，执行 `make target-db` 与 `pnpm --filter @zerp/wfl-starlark wasm:build` 准备本地隔离库与 WASM，再通过受控环境变量提供该库地址运行 `make test-integration`。不得指向共享库或生产库；集成测试写入真实数据，测试仅操作独占隔离库。完成后执行 `make target-down`。

`make target-e2e` 是 CI L3 的运行时验收入口；CI 的 common/tooling 作业分别负责公共检查和 CI 行为测试，本地完整验收统一用 `make e2e`。完整验收只在 Compose Web 镜像内构建 SPA，独立构建仍可运行 `pnpm --filter @zerp/frontend build:target`。通用浏览器套件与 WFL、VOU catalog、VOU opening、VOU entry 四个专项各使用一次独占数据库准备，始终串行；WFL browser parity 只在专属阶段执行。

## Pull Request 检查

质量门禁只对 Pull Request 的测试合并提交运行；`main` 合并后不重复运行这套 CI。检查采用轻量路径白名单，混合变更取最高级，未知路径默认 L3：

- L0：`docs/**/*.md`，以及明确列出的 `README.md`、`AGENTS.md`、`CONTEXT.md`、`frontend/README.md`、`frontend/AGENTS.md`。只运行公共检查，不安装 Go 或 Chromium，也不启动 Target 服务。
- L1：文档检查器、Prettier 配置、CI 分类与汇总脚本、测试及 `.github/workflows/ci.yml`。运行公共检查和工具/CI 行为测试。
- L3：其余所有文件，包括 `.github/workflows/target.yml`、业务代码、SQL、依赖、运行配置和 Target 执行定义。运行公共检查、工具/CI 行为测试和完整 `make target-e2e`。

重命名同时按变更前路径删除和变更后路径新增分类；修改分类规则时，基线规则与新规则分别计算并取较高等级。唯一必需检查为 `ci-required`，它会严格汇总各级必须运行的任务。开发者本地用 `make check`、`make test` 运行独立检查，用 `make e2e` 运行完整验证。

## 生产形态

`compose.yaml` 与 `compose.production.yaml` 发布 Hono API 和 target Web。生产配置从根目录 `.env.production.example` 派生；数据库连接必须显式使用 `TARGET_DATABASE_SCOPE=production`，隔离检查仍只接受 `*_test` 数据库。

API 启动前先同步生成的权限目录，再从 `APP_TEST_ADMIN_PASSWORD_FILE` 和 `APP_TESTER_PASSWORD_FILE` 指向的凭证文件重复校准 `test-admin`、`tester` 两个线上测试用户及其 `superadmin` 角色。数据库首次创建和后续重启都执行同一流程；密码变化会更新哈希并撤销旧会话。`/readyz` 同时验证数据库和全部启用的 RPT definition。Web 构建通过 `TARGET_API_BROWSER_URL` 注入浏览器可访问的 HTTPS API 地址，API 与 Web 使用同一完整 `ZERP_RELEASE_SHA`。

## 文档

- [共享术语](CONTEXT.md)
- [Approval](docs/domains/approval.md)
- [APP](docs/domains/app.md)
- [BOB](docs/domains/bob.md)
- [AUX](docs/domains/aux.md)
- [VOU](docs/domains/vou.md)
- [WFL](docs/domains/wfl.md)
- [ACC](docs/domains/acc.md)
- [RPT](docs/domains/rpt.md)
- [页面用例](docs/use-cases/README.md)
- [架构决策](docs/adr/README.md)
- [Session 与动态页面迁移](docs/adr/0052-session-dynamic-navigation-and-page-migration.md)
- [运行手册](docs/operations/README.md)
- [测试证据](docs/testing/README.md)

## License

MIT，见 [LICENSE](LICENSE)。
