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
make generate-check
make check
make test
make e2e
make target-down
```

`make dev` 启动可丢弃 target 数据库与 Hono API，再以前台 Vite 启动 SPA。`make generate` 从 Hono/Zod 路由和 target schema 生成 OpenAPI、权限目录与 Kysely 类型；`packages/api-client/` 在编译期直接从同一 Hono route type 推导客户端类型。生成物不得手工修改。`make e2e` 重建隔离数据库并运行生成、类型、单元、真实 PostgreSQL 与浏览器门禁。

## Pull Request 检查

质量门禁只对 Pull Request 的测试合并提交运行；`main` 合并后不重复运行这套 CI。检查采用轻量路径白名单，混合变更取最高级，未知路径默认 L3：

- L0：`docs/**/*.md`，以及明确列出的 `README.md`、`AGENTS.md`、`CONTEXT.md`、`frontend/README.md`、`frontend/AGENTS.md`。只运行公共检查，不安装 Go 或 Chromium，也不启动 Target 服务。
- L1：文档检查器、Prettier 配置、CI 分类与汇总脚本、测试及 `.github/workflows/ci.yml`。运行公共检查和工具/CI 行为测试。
- L3：其余所有文件，包括 `.github/workflows/target.yml`、业务代码、SQL、依赖、运行配置和 Target 执行定义。运行公共检查、工具/CI 行为测试和完整 `make target-e2e`。

重命名同时按变更前路径删除和变更后路径新增分类；修改分类规则时，基线规则与新规则分别计算并取较高等级。唯一必需检查为 `ci-required`，它会严格汇总各级必须运行的任务。开发者本地仍可用 `make check`、`make test` 和 `make e2e` 运行完整验证。

## 生产形态

`compose.yaml` 与 `compose.production.yaml` 发布 Hono API 和 target Web。生产配置从根目录 `.env.production.example` 派生；数据库连接必须显式使用 `TARGET_DATABASE_SCOPE=production`，隔离检查仍只接受 `*_test` 数据库。

API 启动前同步生成的权限目录，`/readyz` 同时验证数据库和全部启用的 RPT definition。Web 构建通过 `TARGET_API_BROWSER_URL` 注入浏览器可访问的 HTTPS API 地址，API 与 Web 使用同一完整 `ZERP_RELEASE_SHA`。

#366 的开发测试环境数据库重建、验收和整体回滚见[切换运行手册](docs/operations/issue-366-cutover-runbook.md)。网络、Cookie 与联调细节见[前端 API 配置](docs/operations/frontend-api-configuration.md)。

## 文档

- [共享术语](CONTEXT.md)
- [Approval](docs/domains/approval.md)
- [APP](docs/domains/app.md)
- [DCL](docs/domains/dcl.md)
- [BOB](docs/domains/bob.md)
- [AUX](docs/domains/aux.md)
- [VOU](docs/domains/vou.md)
- [WFL](docs/domains/wfl.md)
- [ACC](docs/domains/acc.md)
- [RPT](docs/domains/rpt.md)
- [页面用例](docs/use-cases/README.md)
- [架构决策](docs/adr/README.md)
- [测试证据](docs/testing/README.md)

## License

MIT，见 [LICENSE](LICENSE)。
