# ZERP Backend

ZERP Backend 是供企业内部使用的 ERP 后端服务，面向基础资料、销售、采购、库存、财务、报表和系统管理等业务场景。服务采用 Go、Gin 和 PostgreSQL 构建，为 ZERP 前端及其他受信任客户端提供统一的业务 API。

本文档既是项目说明，也是后端工程约定。新增接口、数据访问、权限规则和测试时，应遵循本文定义的边界，并与前端 API 契约保持一致。

## 技术栈

| 技术 | 基线版本 | 用途 |
| --- | --- | --- |
| [Go](https://go.dev/) | 1.26 | 服务端开发语言 |
| [Gin](https://gin-gonic.com/) | 1.12 | HTTP 路由、中间件和请求处理 |
| [PostgreSQL](https://www.postgresql.org/) | 18 | 业务数据、权限数据和会话数据存储 |
| [pgx](https://github.com/jackc/pgx) | 5.10 | PostgreSQL 驱动和连接池 |
| [sqlc](https://sqlc.dev/) | 1.31 | 根据 SQL 生成类型安全的数据访问代码 |
| [Goose](https://pressly.github.io/goose/) | 3.27 | 版本化 SQL 数据库迁移 |
| [Docker Compose](https://docs.docker.com/compose/) | Compose v2 | 本地与测试环境编排 |

具体补丁版本以根目录及 `tools` 目录中的 `go.mod`、`go.sum` 和容器配置为准。升级主版本前必须检查迁移指南并完成回归测试。

## 环境要求

- Go 1.26+
- Docker 与 Docker Compose v2
- GNU Make

sqlc 和 Goose 已锁定在独立的 `tools` Go 模块中，无需全局安装。

## 快速开始

复制环境变量模板，并将示例数据库密码替换为仅供本地开发使用的值：

```bash
cp .env.example .env.local
```

启动 API 与 PostgreSQL：

```bash
make compose-up
make migrate-up
```

服务默认监听 `http://localhost:8080`：

```bash
curl http://localhost:8080/healthz
curl http://localhost:8080/readyz
```

- `/healthz`：进程存活检查，不访问数据库。
- `/readyz`：就绪检查，验证 PostgreSQL 连接。

停止容器：

```bash
make compose-down
```

如需直接运行本机 Go 服务，可先单独启动 PostgreSQL、执行迁移，再运行：

```bash
make run
```

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `make run` | 启动本机 Go 服务 |
| `make build` | 编译全部 Go 包 |
| `make test` | 自动准备独立测试库并执行单元测试和数据库集成测试 |
| `make test-unit` | 执行不依赖数据库的单元测试 |
| `make test-integration` | 创建或复用独立测试库、应用全部迁移并执行 APP、BOB、VOU、LED 数据库契约测试 |
| `make generate` | 根据 SQL 重新生成 sqlc 代码 |
| `make migrate-status` | 查看数据库迁移状态 |
| `make migrate-up` | 升级数据库到最新迁移 |
| `make migrate-down` | 回滚一个数据库迁移版本 |
| `make bootstrap-admin` | 在空用户库中创建首个超级管理员（密码取自 `APP_BOOTSTRAP_PASSWORD`） |
| `make seed-bob` | 向开发或测试库幂等写入 BOB 演示数据 |
| `make cleanup-attachments` | 在 Compose API 的同一持久卷中清理 VOU 附件及未提交的过期反馈截图 |
| `make cleanup-vou-attachments` | `cleanup-attachments` 的兼容别名 |
| `make compose-up` | 构建并启动 API、PostgreSQL 与 pgAdmin |
| `make compose-down` | 停止容器 |

## 配置

应用只从环境变量读取运行配置。Make 和 Compose 默认读取 `.env.local`，也可通过 `ENV_FILE` 指定其他文件；本地环境文件均被 Git 忽略，模板见 `.env.example`。

```bash
make ENV_FILE=.env.test compose-up
```

| 变量 | 必填 | 默认值 | 用途 |
| --- | --- | --- | --- |
| `DATABASE_URL` | 是 | 无 | PostgreSQL 连接串 |
| `TEST_POSTGRES_DB` | 测试时是 | 无 | 独立测试数据库名；必须以 `_test` 结尾且不得与 `POSTGRES_DB` 相同 |
| `TEST_DATABASE_URL` | 测试时是 | 无 | 独立测试数据库连接串；实际连接库必须与 `TEST_POSTGRES_DB` 一致 |
| `API_PORT` | 否 | `8080` | Compose 暴露到宿主机的 API 端口 |
| `POSTGRES_PORT` | 否 | `5432` | Compose 暴露到宿主机的 PostgreSQL 端口 |
| `PGADMIN_DEFAULT_EMAIL` | Compose 启动时是 | 无 | pgAdmin 初始管理员邮箱 |
| `PGADMIN_PORT` | 否 | `5050` | pgAdmin 仅在宿主机回环地址监听的端口 |
| `PGADMIN_PASSWORD_FILE` | Compose 启动时是 | 无 | pgAdmin 初始管理员密码文件 |
| `PGADMIN_PGPASS_FILE` | Compose 启动时是 | 无 | pgAdmin 连接项目 PostgreSQL 的 pgpass 文件 |
| `APP_ENV` | 否 | `development` | `development`、`test` 或 `production` |
| `HTTP_ADDRESS` | 否 | `:8080` | HTTP 监听地址 |
| `CORS_ALLOWED_ORIGINS` | 否 | 直跑为空；Compose 允许本地 `5173`/`4173` 联调 Origin | 允许携带凭证的前端 Origin，多个值用逗号分隔 |
| `DATABASE_CONNECT_TIMEOUT` | 否 | `5s` | 首次连接数据库超时 |
| `DATABASE_HEALTH_TIMEOUT` | 否 | `2s` | 数据库就绪检查超时 |
| `HTTP_READ_HEADER_TIMEOUT` | 否 | `5s` | HTTP 请求头读取超时 |
| `SHUTDOWN_TIMEOUT` | 否 | `10s` | 优雅关闭等待时间 |
| `APP_SESSION_COOKIE_NAME` | 否 | `zerp_session` | 服务端会话 Cookie 名称 |
| `APP_SESSION_COOKIE_SECURE` | 否 | `true` | 是否仅通过 HTTPS 发送会话 Cookie；纯 HTTP 本地调试可设为 `false` |
| `APP_SESSION_COOKIE_SAME_SITE` | 否 | `lax` | Cookie SameSite：`lax`、`strict` 或 `none`；`none` 强制要求 Secure |
| `APP_SESSION_IDLE_TIMEOUT` | 否 | `30m` | 会话空闲有效期 |
| `APP_SESSION_ABSOLUTE_TIMEOUT` | 否 | `12h` | 会话绝对有效期 |
| `APP_SIGNIN_LOCK_THRESHOLD` | 否 | `5` | 连续登录失败后的锁定阈值 |
| `APP_SIGNIN_LOCK_DURATION` | 否 | `15m` | 登录临时锁定时长 |
| `APP_PASSWORD_MIN_LENGTH` | 否 | `12` | 新用户密码最小长度，允许范围为 8–128 |
| `ATTACHMENT_STORAGE_ROOT` | 生产是 | 开发/测试为 `./var/attachments` | VOU 与反馈截图的私有附件持久目录；生产必须是绝对路径 |
| `ATTACHMENT_UPLOAD_TOKEN_TTL` | 否 | `15m` | 一次性附件上传令牌有效期 |
| `ATTACHMENT_DOWNLOAD_TOKEN_TTL` | 否 | `5m` | 一次性附件下载令牌有效期 |
| `FEEDBACK_ATTACHMENT_ORPHAN_TTL` | 否 | `24h` | 已上传但未提交反馈的截图保留时长 |
| `FEEDBACK_GITHUB_ENABLED` | 生产是 | `false` | 是否启用 APP 用户反馈与 GitHub Issue 发布；生产必须为 `true` |
| `FEEDBACK_GITHUB_REPOSITORY` | 否 | `hansonyu183/zerp-back` | 用户反馈 Issue 的目标仓库，格式为 `owner/repository` |
| `FEEDBACK_GITHUB_TOKEN` | 启用时是 | 无 | 仅具目标仓库 Issues 读写权限的细粒度令牌；不得写入仓库或日志 |

`make test` 会启动并等待 Compose 的 `db` 服务，幂等创建 `TEST_POSTGRES_DB`，使用 Goose 应用全部迁移，再执行带 `integration` 构建标签的 APP、BOB、VOU、LED 数据库测试。测试库会保留供后续运行复用；安全校验会拒绝非 `_test` 后缀、与 `POSTGRES_DB` 相同或实际连接库名不匹配的配置。

本机直接运行服务且未配置 CORS Origin 时，不允许任何跨域浏览器请求；同源请求和不携带 `Origin` 的服务间请求不受影响。Docker Compose 为本地开发默认允许 `http://localhost:5173`、`http://127.0.0.1:4173` 和 `http://localhost:4173`，生产环境必须显式配置实际前端 Origin。

执行全部迁移后，可在用户表为空时创建初始管理员。密码长度不得超过 256 个字符，并且必须同时包含小写字母、大写字母、数字和符号。该命令在已有任意用户后会拒绝执行。

使用隐藏输入，避免将真实密码写入命令行历史：

```bash
printf 'Bootstrap password: '
read -r -s APP_BOOTSTRAP_PASSWORD
printf '\n'
export APP_BOOTSTRAP_PASSWORD
make bootstrap-admin
unset APP_BOOTSTRAP_PASSWORD
```

本地联调可执行 `make seed-bob`，为客户、供应商、员工、产品、服务、仓库、车辆、资金账户、结算方式、分类、部门和岗位写入 24 条演示数据，并覆盖 `EFFECTIVE`、`DRAFT`、`PENDING`、`REJECTED` 状态。演示数据先创建有效员工和结算方式等参考对象，再创建带分类、部门、岗位、业务员、结算方式、负责人和物流平台引用的对象；有效客户与普通供应商均绑定 `DEMO-SM-001`，并使用 `DEMO-EMP-001` 作为业务员，车辆归属自营物流平台。命令仅允许在 `development` 或 `test` 环境运行；重复执行会核验并跳过已有演示数据，不会覆盖同代码的其他内容。

## 目录结构

```text
.
├─ cmd/
│  ├─ server/                  # 服务入口与优雅关闭
│  ├─ bootstrap-admin/         # 首个超级管理员初始化命令
│  ├─ seed-bob/                # BOB 开发/测试数据填充命令
│  └─ cleanup-vou-attachments/ # VOU 附件清理命令
├─ db/
│  ├─ migrations/              # Goose SQL 迁移
│  └─ queries/                 # sqlc SQL 查询
├─ docs/
│  └─ domains/                 # 后端业务域规格
├─ internal/
│  ├─ api/
│  │  ├─ middleware/           # requestId、日志、恢复和 CORS
│  │  └─ response/             # 统一业务响应包络与错误码
│  ├─ config/                  # 环境变量解析与校验
│  ├─ database/                # pgx 连接池及 sqlc 生成代码
│  ├─ domains/                 # 领域服务、Handler 和领域类型
│  ├─ httpserver/              # Gin 路由与健康检查
│  ├─ platform/                # 跨领域运行时基础设施（事务事件等）
│  └─ seed/                    # 非生产环境演示数据编排
├─ tools/                      # sqlc、Goose 独立工具模块
├─ compose.yaml
├─ Dockerfile
├─ Makefile
└─ sqlc.yaml
```

## 业务域文档

当前已经确定以下后端业务域。业务规则、数据模型、状态机、接口契约和测试验收条件以对应领域文档为准：

| 领域 | 标识 | 范围 | 文档 |
| --- | --- | --- | --- |
| 应用访问与权限 | `app` | 用户认证、Cookie 会话、CSRF、角色与 API 权限 | [APP 后端业务域](docs/domains/app.md) |
| 基础业务对象 | `bob` | 客户、供应商、物流平台、员工、产品、服务、仓库、车辆、资金账户、分类、部门、岗位、结算方式及其版本审核 | [BOB 后端业务域](docs/domains/bob.md) |
| 业务单据 | `vou` | 销售、采购、居间销售、收付款、费用报销、其它收入及附件与审计 | [VOU 后端单据域](docs/domains/vou.md) |
| 业务账簿 | `led` | 统一期初、库存、资金、往来流水与余额 | [LED 后端账簿域](docs/domains/led.md) |

Cloudflare Pages、本地 Vite、Cookie、CSRF 和请求封装见 [前端 API 配置说明](docs/frontend-api-configuration.md)。

README 只保留跨领域工程约定。实现具体领域时，应同时满足本文与领域文档；发生冲突时，应先修正文档并明确统一契约，不能由实现自行选择不同语义。

## 跨领域事务事件

进程内领域协作使用 `internal/platform/txevent` 提供的同步事务事件总线。发布者负责创建事务，并在自身业务写入完成后、提交前调用 `Publish`；发布器按注册顺序串行调用当前主题的订阅者，并把同一个 `pgx.Tx` 传给它们。任一订阅者返回错误或发生 panic 时立即停止后续投递，由发布者回滚整个事务。

订阅者必须使用传入的事务完成所有需要原子提交的数据库读写，不得改用连接池另开事务。事务订阅期间禁止调用外部服务、写文件、发送消息、启动异步任务或执行其他无法随 PostgreSQL 事务回滚的副作用。没有订阅者的主题视为投递成功。

事件总线只负责当前进程内的同步一致性，不提供持久化事件、异步投递、重试、跨服务事务或 outbox。订阅关系在服务启动装配阶段建立；同一主题内的订阅者名称必须唯一。

## API 总则

开发、测试和生产环境使用相同的 API 协议。业务源码不得为不同环境引入不同的请求结构、响应结构或权限语义。

### 请求规范

所有业务 API 使用 `POST + application/json`，路径固定为三级：

```text
/{domain}/{entity}/{action}
```

| 层级 | 含义 | 示例 |
| --- | --- | --- |
| `domain` | 业务领域，对应前端一级动态菜单 | `app`、`bob` |
| `entity` | 业务实体，对应前端二级菜单及页面 | `user`、`customer` |
| `action` | 对实体执行的操作 | `signin`、`query`、`save`、`approve` |

示例：

```text
POST /app/user/signin
POST /app/user/session
POST /app/user/signout
POST /bob/customer/query
POST /bob/customer/approve
```

请求体直接使用当前操作所需的 JSON 数据。列表查询统一使用以下结构：

```json
{
  "page": 1,
  "pageSize": 20,
  "filters": {
    "status": "open"
  },
  "sort": [
    { "field": "createdAt", "order": "desc" }
  ]
}
```

服务端必须为可过滤和可排序字段建立显式白名单，不得将客户端字段名或排序方向直接拼接到 SQL 中。分页大小、过滤条件和排序项必须经过校验并设置合理上限。

### 响应规范

应用服务器已接收并处理的请求始终返回 HTTP 200，响应包络固定为：

```json
{
  "code": 0,
  "message": "ok",
  "data": {},
  "requestId": "01J..."
}
```

- `code === 0`：业务成功。
- `code !== 0`：业务失败。
- `message`：供用户提示或诊断，不能作为客户端程序判断条件。
- `data`：操作结果；无数据时由具体接口契约明确为 `null`、对象或数组。
- `requestId`：一次请求的全链路追踪标识，必须同时进入结构化日志。

列表查询成功时，`data` 统一为：

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "pageSize": 20
}
```

业务错误码必须稳定区分以下类别，具体数值由后端 API 契约集中维护：

- 未登录或会话失效；
- 已登录但无操作权限；
- 并发更新或数据冲突；
- 参数或字段校验失败；
- 服务端内部异常。

HTTP 200 只表示应用服务器返回了业务处理结果。请求未到达应用、CORS 拒绝、TLS 失败、连接中断、网关超时或服务不可用等传输层与基础设施错误，可以使用相应的非 200 状态或由客户端表现为网络错误。框架默认错误和代理错误不得伪装成符合业务包络的成功响应。

### 参数校验与错误处理

- 在进入业务逻辑前校验 JSON 格式、必填字段、类型、长度、取值范围和分页参数。
- 字段校验失败必须返回稳定的业务错误类别；如需返回字段级详情，应由统一 API 契约定义，不能由各接口自行发明结构。
- 对外错误信息不得包含 SQL、堆栈、内部路径、数据库对象名或敏感业务数据。
- 内部异常必须记录 `requestId` 和必要的诊断上下文，并向客户端返回统一的内部异常业务码。
- 不得以 `message` 文本、数据库错误文本或 HTTP 状态码代替稳定的业务码判断。

## Cookie 会话与 CSRF

鉴权使用由后端管理的 Cookie 会话：

```text
POST /app/user/signin   # 登录并写入会话 Cookie
POST /app/user/session  # 恢复用户、权限及 CSRF Token
POST /app/user/signout  # 注销并清理会话 Cookie
```

- 会话 Cookie 必须设置 `Secure`、`HttpOnly` 和符合部署拓扑的 `SameSite` 属性。
- 会话标识必须使用密码学安全的随机值；数据库只保存满足安全设计要求的会话记录，不得在日志中输出原始 Cookie。
- 会话必须支持服务端失效、到期清理和注销后立即失效。
- `session` 接口返回当前用户、完整 API 权限路径数组和 CSRF Token，具体结构见 APP 领域文档。
- 登录后的请求必须携带并校验 `X-CSRF-Token`；Token 不得写入日志或错误详情。
- 未登录或会话失效返回稳定的未登录业务码；权限不足返回稳定的无权限业务码，二者不得混用。
- 跨域部署时，CORS 只能允许配置中明确列出的前端 Origin，并允许凭证；禁止在凭证模式下使用通配符 Origin。
- CORS、Cookie Domain、Cookie Path、SameSite 和 HTTPS 配置必须作为一个整体按实际部署域名验证。

## 动态菜单与权限

登录或恢复会话后，后端返回当前用户可调用的完整 API 权限路径数组，例如 `/bob/customer/query`。前端按 `/{domain}/{entity}/{action}` 解析权限，并与本地页面注册表共同生成两级菜单和动态路由。

- 一级菜单使用 `domain`；
- 二级菜单使用 `entity`；
- 每个实体以 `/{domain}/{entity}/query` 作为菜单准入权限；
- 页面内动作使用完整 API 路径判断；
- 前端页面路由使用 `/${domain}/${entity}`。

后端不返回菜单标题、图标、顺序或可供前端导入的组件路径。前端菜单和按钮控制只用于改善交互，不构成安全边界。

每个业务请求都必须重新校验：

1. 会话是否存在且有效；
2. 用户、角色及相关授权是否仍然有效；
3. 当前用户是否拥有目标 `domain/entity/action` 的动作权限；
4. 操作涉及的数据范围是否在用户授权范围内。

路由是否可见、按钮是否隐藏以及客户端是否曾通过 `session` 获取权限，均不能代替服务端鉴权。

## PostgreSQL 数据约定

### 数据访问

- 使用 pgx 管理 PostgreSQL 连接和连接池。
- 业务 SQL 由 sqlc 生成类型安全的数据访问代码，生成代码不得手工修改。
- 复杂查询优先保持为可审阅、可分析执行计划的显式 SQL。
- 所有外部输入必须通过绑定参数传入，不得拼接为 SQL 文本。
- 数据访问错误应在适当边界转换为稳定的领域错误，禁止将驱动错误直接返回客户端。

### 事务

- 一个业务动作涉及多次关联写入时，必须在同一数据库事务中保证原子性。
- 事务边界由业务用例控制，不得隐藏在无法组合的单条数据访问函数中。
- 事务内不得执行不受控的外部网络调用或长时间计算。
- 必须正确处理提交、回滚、上下文取消和数据库连接异常。
- 财务、库存等关键写入必须明确并发策略，检测到并发更新或数据冲突时返回对应的稳定业务错误类别，不得静默覆盖。

### 数据库迁移

- 使用 Goose 管理顺序、版本化的 SQL 迁移。
- 表、索引、约束、函数或基础数据的结构变化必须通过迁移提交，不得仅在运行环境中手工修改。
- 迁移应保持可审阅、可重复执行，并明确升级及必要的回滚策略。
- 生产迁移前必须在与生产版本一致的测试环境验证，并完成备份和恢复方案检查。
- 应用启动不应在未经明确部署控制的情况下自动修改生产数据库结构。

## 首期业务范围

首期实现已经完成领域定界的 APP、BOB、VOU 与 LED：

- APP 建立登录会话、恢复会话、退出登录、用户、角色和精确 API 路径权限能力；
- BOB 建立客户、供应商、员工、产品、服务、仓库、车辆、资金账户、分类、部门、岗位和结算方式的对象版本及审核能力；
- VOU 建立七类单据、人员与结算规则快照、审核/批准/执行及反向流转、附件和审计能力；
- LED 订阅 VOU 执行与反执行事务事件，生成库存、资金和往来流水，提供统一期初、严格负库存校验、余额查询及可重开启用流程；
- 库存、核销、总账和报表领域在业务规则明确并形成独立领域文档后接入。

新增领域、实体和动作编码必须先进入领域文档与后端路由权限目录，不能只在前端注册菜单或临时扩展接口。

## 可观测性

- 每个进入应用的请求必须生成或接收符合约定的 `requestId`，并在响应和结构化日志中返回同一标识。
- 日志至少应支持按 `requestId`、业务域、业务实体、动作和结果类别检索。
- 日志不得记录密码、会话 Cookie、CSRF Token、数据库连接凭证、完整个人敏感信息或未经脱敏的业务数据。
- 对认证失败、权限拒绝、并发冲突和内部异常保留满足审计与排障需要的事件信息。
- 健康检查、指标和追踪接口的路径及数据结构在实现时单独约定，不纳入三级业务 API。

## 测试策略

测试实现后，应至少覆盖以下边界。

### 单元测试

- 参数校验、业务错误映射和响应包络；
- 会话、CSRF、权限数组和动作权限判断；
- 领域逻辑、金额与数量计算及并发冲突处理；
- `requestId` 传播和敏感日志过滤。

### 数据库集成测试

- 在独立 PostgreSQL 测试库中执行真实迁移和 sqlc 查询；
- 覆盖事务提交、回滚、约束冲突、并发更新及分页查询；
- 每个测试可重复运行并清理数据，不依赖执行顺序；
- 禁止连接生产数据库或复用生产凭证。

### 端到端测试

前端 Playwright 测试连接独立的真实测试后端。核心业务流程不得通过请求拦截模拟，至少覆盖：

1. 登录并建立真实 Cookie 会话；
2. 刷新页面后恢复用户、权限数组和 CSRF Token；
3. 根据权限数组与前端本地注册表进入客户页面；
4. 查询、创建并提交真实测试客户数据；
5. 验证无权限动作被后端拒绝；
6. 验证会话失效后的未登录业务响应；
7. 注销并确认原会话无法继续使用。

测试账号、连接信息和数据初始化方式必须通过 CI 密钥或受控测试环境提供，不得提交到 Git。

## 运行与部署

Docker Compose 是本地开发和测试环境的标准运行方式，统一编排 API 与 PostgreSQL；生产环境使用构建后的 Go 服务制品连接受控 PostgreSQL 实例。

运行配置必须满足：

- 配置通过环境变量或受控密钥系统注入，不在仓库中保存凭证；
- 开发、测试和生产使用相互隔离的数据库、会话配置和允许 Origin；
- 前端和 API 均使用 HTTPS；
- 数据库迁移作为明确的部署步骤执行；
- 发布前通过构建、单元测试、数据库集成测试和真实测试后端上的关键端到端流程。
- 使用本地附件存储时生产 API 只能运行单实例，附件目录必须挂载持久卷，并与数据库共同备份和恢复。
- 用户反馈发布必须使用最小权限 GitHub 令牌；新 Issue 默认带 `automation:blocked`，人工审核后才能交给自动化处理。

## 安全要求

- 禁止提交密码、Cookie、CSRF Token、数据库连接串、API 密钥、生产数据或测试账号。
- 密码必须使用适合密码存储的强哈希算法处理，不得明文保存或使用可逆加密代替哈希。
- 所有客户端输入均视为不可信数据，必须完成格式、权限和数据范围校验。
- 后端权限判断是最终安全边界，前端隐藏菜单或按钮不能代替鉴权。
- 错误响应和日志不得泄露 SQL、堆栈、内部路径、凭证或敏感业务数据。
- 涉及真实数据的调试必须使用受控账号，并遵循企业数据访问、审计和最小权限要求。
- 依赖与容器基础镜像应定期检查安全更新，升级后完成回归测试。

## License

许可证信息见 [LICENSE](./LICENSE)。
