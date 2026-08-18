# ZERP Backend

ZERP 后端是单仓中的 Go API，负责领域服务、权限校验、事务、PostgreSQL 持久化、附件和运行状态端点。HTTP 线协议以根目录 OpenAPI 为准，业务规则以根目录领域文档为准。

## 技术与环境

- Go 1.26.6
- Gin、pgx、sqlc、Goose
- PostgreSQL 18
- Docker Compose v2、GNU Make

sqlc 和 Goose 锁定在 `tools` Go 模块中，无需全局安装。

从仓库根目录启动完整开发环境：

```bash
cp backend/.env.example backend/.env.local
make bootstrap
make dev
```

仅运行后端时：

```bash
cd backend
docker compose --env-file .env.local up -d --wait db
make migrate-up
make run
```

`make compose-up` 会同时启动容器化 API 和 PostgreSQL，是另一种完整后端启动方式；不要再与占用同一 API 端口的 `make run` 组合使用。

服务默认监听 `http://localhost:8080`：

```bash
curl http://localhost:8080/healthz
curl http://localhost:8080/readyz
```

`/healthz` 只检查进程，`/readyz` 还验证 PostgreSQL 连接。

## 常用命令

| 命令                          | 用途                           |
| ----------------------------- | ------------------------------ |
| `make run`                    | 启动本机 Go 服务               |
| `make build`                  | 编译全部 Go 包                 |
| `make test`                   | 执行单元测试和数据库集成测试   |
| `make test-unit`              | 执行不依赖数据库的测试         |
| `make test-migration-upgrade` | 从上一版本带数据升级到最新迁移 |
| `make test-integration`       | 在独立测试库运行领域数据库测试 |
| `make generate`               | 生成 sqlc 代码                 |
| `make quality`                | 运行后端完整质量检查           |
| `make migrate-status`         | 查看迁移状态                   |
| `make migrate-up`             | 应用全部迁移                   |
| `make migrate-down`           | 回滚一个迁移版本               |
| `make bootstrap-admin`        | 在空用户库创建首个管理员       |
| `make seed-bob`               | 幂等写入非生产 BOB 演示数据    |
| `make seed-preview`           | 幂等补齐开发预览全业务测试数据 |
| `make cleanup-attachments`    | 清理过期附件和未提交反馈截图   |
| `make compose-up`             | 启动后端 API 与 PostgreSQL     |
| `make compose-down`           | 停止后端 Compose               |

根目录的 `make generate` 会同时生成 OpenAPI 客户端、服务端类型和 sqlc。模块命令用于开发期反馈。

数据库集成检查自动发现所有带 `integration` build tag 的 Go 包，并为每个包重建独立测试库，避免包顺序和残留数据影响结果。迁移测试先应用到最新版本的前一版，执行 `db/migration-tests/<最新版本>_before.sql`，再升级并执行对应的 `_after.sql`；新增迁移时必须补齐这两个升级夹具。普通 Go 测试在 race 模式下生成覆盖率并检查不低于当前基线。

## 配置

应用只读取环境变量。后端 Make 和 Compose 默认使用 `.env.local`，也可通过 `ENV_FILE` 指定文件：

```bash
make ENV_FILE=.env.test compose-up
```

模板位于 `.env.example`，本地环境文件被 Git 忽略。

| 变量                             | 默认值              | 用途                                  |
| -------------------------------- | ------------------- | ------------------------------------- |
| `DATABASE_URL`                   | 无                  | PostgreSQL 连接串，必填               |
| `POSTGRES_DB`                    | `zerp`              | Compose 主数据库名                    |
| `POSTGRES_USER`                  | `zerp`              | Compose 数据库用户                    |
| `POSTGRES_PASSWORD`              | 无                  | Compose 本地数据库密码                |
| `TEST_POSTGRES_DB`               | 无                  | 独立测试库，必须以 `_test` 结尾       |
| `TEST_POSTGRES_PORT`             | `55434`             | 独立测试数据库端口                    |
| `API_PORT`                       | `8080`              | Compose API 宿主机端口                |
| `POSTGRES_PORT`                  | `5432`              | Compose PostgreSQL 宿主机端口         |
| `APP_ENV`                        | `development`       | `development`、`test` 或 `production` |
| `HTTP_ADDRESS`                   | `:8080`             | HTTP 监听地址                         |
| `CORS_ALLOWED_ORIGINS`           | 空                  | 允许携带凭证的精确 Origin 列表        |
| `DATABASE_CONNECT_TIMEOUT`       | `5s`                | 初始数据库连接超时                    |
| `DATABASE_HEALTH_TIMEOUT`        | `2s`                | 数据库健康检查超时                    |
| `HTTP_READ_HEADER_TIMEOUT`       | `5s`                | 请求头读取超时                        |
| `HTTP_READ_TIMEOUT`              | `2m`                | 完整请求读取超时                      |
| `HTTP_WRITE_TIMEOUT`             | `2m`                | 完整响应写入超时                      |
| `HTTP_IDLE_TIMEOUT`              | `60s`               | Keep-Alive 空闲超时                   |
| `SHUTDOWN_TIMEOUT`               | `10s`               | 优雅关闭等待时间                      |
| `APP_SESSION_COOKIE_NAME`        | `zerp_session`      | 会话 Cookie 名称                      |
| `APP_SESSION_COOKIE_SECURE`      | `true`              | 是否只通过 HTTPS 发送 Cookie          |
| `APP_SESSION_COOKIE_SAME_SITE`   | `lax`               | Cookie SameSite 策略                  |
| `APP_SESSION_IDLE_TIMEOUT`       | `30m`               | 会话空闲有效期                        |
| `APP_SESSION_ABSOLUTE_TIMEOUT`   | `12h`               | 会话绝对有效期                        |
| `APP_SIGNIN_LOCK_THRESHOLD`      | `5`                 | 登录失败锁定阈值                      |
| `APP_SIGNIN_LOCK_DURATION`       | `15m`               | 登录锁定时间                          |
| `APP_PASSWORD_MIN_LENGTH`        | `12`                | 新密码最小长度                        |
| `ATTACHMENT_STORAGE_ROOT`        | `./var/attachments` | 私有附件目录，生产必须为绝对路径      |
| `ATTACHMENT_UPLOAD_TOKEN_TTL`    | `15m`               | 一次性上传令牌有效期                  |
| `ATTACHMENT_DOWNLOAD_TOKEN_TTL`  | `5m`                | 一次性下载令牌有效期                  |
| `FEEDBACK_ATTACHMENT_ORPHAN_TTL` | `24h`               | 未提交反馈截图保留时间                |
| `FEEDBACK_GITHUB_ENABLED`        | `false`             | 是否发布反馈 Issue                    |
| `FEEDBACK_GITHUB_REPOSITORY`     | `hansonyu183/zerp`  | 反馈 Issue 目标仓库                   |
| `FEEDBACK_GITHUB_TOKEN`          | 无                  | 最小权限 GitHub Token                 |

生产必须显式配置数据库、附件目录、Cookie、Origin 和反馈发布凭证。凭证只能进入受控环境变量或密钥系统，不得写入仓库、命令行参数或日志。

## 数据库与初始化

查询 SQL 位于 `db/queries/`，迁移位于 `db/migrations/`。修改 SQL 后运行根目录 `make generate`；不得手工编辑 `internal/database/sqlc/`。

`make test` 使用独立的 `zerp-api-test` Compose 项目和 `55434` 端口，拒绝主数据库名、非 `_test` 数据库及端口冲突。通过 `make quality` 或根目录 `make check` 运行时会自动清理测试容器和卷。

空用户库可创建首个管理员：

```bash
read -r -s APP_BOOTSTRAP_PASSWORD
export APP_BOOTSTRAP_PASSWORD
make bootstrap-admin
unset APP_BOOTSTRAP_PASSWORD
```

该命令在已有用户时拒绝执行。`make seed-bob` 只允许在 `development` 或 `test` 环境运行。
`make seed-preview` 只允许连接受管预览实例中的 `zerp_preview` 或 `zerp_preview_pr_<PR号>`；数据库
名称、角色、地址和端口必须同时匹配预览运行时，普通开发库、测试库和生产库都会在写入前被拒绝。
它会补齐 AUX、BOB、全部 VOU 单据、WFL、ACC 和预置 RPT 所需事实。每个业务对象或单据至少提供
可操作草稿或关键已批准链路，并建立控制账簿、零期初及全单据会计映射；重复执行只恢复 seed
自身中断的步骤，不覆盖测试人员已经修改或推进的样本。

## 隔离 E2E 后端

优先从仓库根目录运行自包含全栈 E2E：

```bash
make e2e
```

需要单独保留后端测试环境时，可在本目录运行：

```bash
make e2e-env-init
cd ..
make e2e
```

完整 E2E 使用数据库 `zerp_e2e`、API 端口 `18081`、PostgreSQL 端口 `55435` 和专用 Cookie；运行结束后自动清理一次性数据库容器和本机进程。

安全校验固定拒绝生产环境、非隔离数据库、错误端口和启用 GitHub 反馈发布的配置。

## 目录

```text
backend/
├─ cmd/                         # 服务和运维命令入口
├─ db/
│  ├─ migrations/              # Goose 迁移
│  └─ queries/                 # sqlc 查询
├─ internal/
│  ├─ api/
│  │  ├─ generated/            # OpenAPI 生成服务端类型
│  │  ├─ middleware/           # requestId、日志、恢复和 CORS
│  │  └─ response/             # 统一响应适配
│  ├─ config/                  # 环境变量解析与校验
│  ├─ database/                # pgx 与 sqlc 生成代码
│  ├─ domains/                 # 领域服务、Handler 和类型
│  ├─ httpserver/              # 路由与健康检查
│  ├─ integrations/            # 跨领域的定向适配器
│  ├─ platform/                # 跨领域事务基础设施
│  └─ seed/                    # 非生产数据初始化
├─ tools/                      # 锁定的 Go 开发工具
├─ compose.yaml
├─ Dockerfile
├─ Makefile
└─ sqlc.yaml
```

## 模块边界与复用

后端按“领域规则、定向集成、领域无关平台能力”分层：

- `internal/domains/<domain>` 拥有该领域模型、事务用例和业务规则；Handler 只做协议适配，Service 的必需依赖全部通过构造函数注入，实例创建后即可安全调用；
- `internal/integrations/<purpose>` 承载两个既有领域之间稳定且无业务决策的映射，例如把 AUX 引用适配为 BOB 所需引用；适配器名称和 import 必须体现依赖方向；
- `internal/platform` 承载事务事件、定点小数等领域无关能力。只有语义稳定、边界明确且确实跨领域复用的逻辑才进入该目录，金额含义、单据状态和默认业务规则仍留在领域内；
- 固定形状查询统一命名并写入 `db/queries/`，由 sqlc 生成类型安全调用；动态 SQL 仅用于无法预先表达的动态筛选或排序，并集中在单一查询实现中。

新增抽取前先判断所有权：协议或业务含义属于领域，两个领域间的翻译属于 `integrations`，完全不依赖领域语义的确定性能力才属于 `platform`。不要创建无边界的 `common`、`utils` 包。

## 跨领域事务事件

进程内领域协作使用 `internal/platform/txevent` 的同步事务事件总线：

- 发布者创建事务，在自身写入完成后、提交前发布；
- 订阅者按注册顺序串行执行并复用同一个 `pgx.Tx`；
- 任一订阅者报错或 panic，发布者回滚整个事务；
- 订阅期间禁止外部网络、文件、异步任务等不可回滚副作用；
- 该总线不提供持久化、重试、跨进程投递或 outbox。

## 领域与部署

领域规则和前后端职责从根 [README 文档索引](../README.md#文档)进入；模块内不维护第二份领域清单。

同源 Web 与 Cloudflare Pages 两种部署共享相同 API。Origin、Cookie 和前端基址配置见[前端 API 配置手册](../docs/operations/frontend-api-configuration.md)。

生产迁移必须作为明确部署步骤执行。附件使用本地持久目录时，API 只能运行单实例，并与数据库共同备份和恢复。

## License

MIT，见根目录 [LICENSE](../LICENSE)。
