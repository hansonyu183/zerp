# ZERP 后端工程约束

## 文件系统边界

- 本模块位于 `backend/`，共享契约、领域文档和运行环境以根目录 `AGENTS.md`、`README.md` 为准。
- 纯后端任务默认只修改 `backend/`；跨端契约任务按根规则同时修改 OpenAPI、后端适配、前端调用和测试。

## 工程约定

- 后端使用 Go、Gin、pgx 和 sqlc；`db/schema.sql` 是可丢弃数据库的当前完整结构。
- sqlc 锁定在 `tools` Go 模块中，不得改用全局安装的工具版本。
- 事务边界由领域用例控制；Handler 仅负责协议适配、参数校验和响应转换，不承载业务规则。
- 事务内领域事件的订阅者必须复用发布者的同一个 `pgx.Tx` 并同步执行；任一订阅失败时整体回滚，订阅期间不得产生外部网络、文件、异步任务等不可回滚副作用。
- 查询 SQL 写入 `db/queries/`，完整结构写入 `db/schema.sql`。结构变化直接更新当前基线并重建可丢弃数据库；修改后执行 `make generate`，不得手工编辑 `internal/database/sqlc/` 下的生成代码。
- 数据库优先使用 PK、FK、NOT NULL、UNIQUE 和简单 CHECK 表达不变量；需要跨实体决策的规则由领域 Service 事务和集成测试保证。复杂 trigger、advisory lock、全局 View 或跨实体验证函数必须记录普通约束或事务无法解决的并发竞态。
- 开发期至少运行与变更相关的生成、测试和静态检查；涉及运行环境时额外验证 Docker Compose 服务及健康检查。

## 目录组织与运行安全

- `cmd/` 放服务和运维命令入口；`db/schema.sql` 放当前完整结构，`db/queries/` 放 sqlc 查询；`internal/api/` 放生成协议类型、中间件和统一响应适配；`internal/config/` 解析和校验环境变量；`internal/database/` 放 pgx 与 sqlc 生成代码；`internal/domains/` 放领域服务、Handler 和类型；`internal/httpserver/` 放路由和健康检查；`internal/seed/` 放非生产数据初始化。
- 应用只读取环境变量。Make 和 Compose 默认使用 `.env.local`，也可通过 `ENV_FILE` 指定受控环境文件；模板为 `.env.example`。凭证只能进入受控环境变量或密钥系统，不得写入仓库、命令行参数或日志。
- 公网内测必须显式配置数据库、附件目录、Cookie 和 Origin。数据库按当前基线重建，不维护历史升级链；本地持久附件目录只支持单实例 API。
- 容器化 API 和 PostgreSQL 统一从仓库根目录用 `make compose-up` 启动，不得在 `backend/` 维护第二套 Compose；容器化 API 不得与占用同一端口的 `make run` 同时使用。
- `make test` 必须使用独立的 `zerp-api-test` Compose 项目和测试数据库；测试数据库名必须以 `_test` 结尾，且不得与主数据库或端口冲突。完整 E2E 必须使用根目录 `make e2e` 创建的隔离环境，不得连接生产或普通开发库。
- 完整 E2E 固定拒绝生产环境、非隔离数据库和错误端口；结束后必须清理一次性数据库容器和本机进程。
- `make bootstrap-admin` 只能用于空用户库；`make seed-bob` 只允许在 `development` 或 `test` 环境运行。`make seed-test` 默认只能写入隔离 E2E 测试实例；当前公网开发库只有在显式选择 `SEED_TARGET=development`、开启本地受控开关且数据库身份精确匹配时才允许写入，正式生产环境启用前必须移除该入口和开关。测试 seed 必须保持幂等，只恢复自身中断的步骤，不覆盖测试人员已修改或推进的样本。

## 模块边界与公共复用

- 领域 Service 必须在构造完成时即可安全使用；确需替换、隔离或跨域协作的外部能力由构造函数显式注入。固定 SQL 直接通过 sqlc 查询使用；不为简单 CRUD 额外引入 Repository/Store 接口、后置 Setter、空占位接口或调用顺序依赖。
- 领域包保留业务规则和自身模型。两个领域之间稳定、无业务决策的类型映射或引用解析放在 `internal/integrations/<purpose>/`，由适配器明确依赖方向；不得在 `httpserver`、seed 或多个领域包中复制同一转换逻辑。
- `internal/platform/` 只接收确定为领域无关的基础能力。公共工具应具备稳定语义、清晰边界并至少被多个领域复用；金额精度、状态含义、默认值等领域决策不得为了消除少量重复而下沉成通用函数。
- 中央 Approval 固定位于 `internal/platform/approval/`，直接接收调用方 `pgx.Tx` 并使用 APP Authorizer；审批版本号、开放候选约束与 latest approved 查询也归中央 Approval，Domain 不得提供 Approval Store Adapter、任意 permission path、callback/hook、版本指针或第二套审批与版本持久化。
- 固定形状、可命名的查询必须写入 `db/queries/` 并通过 sqlc 调用；只有确实需要动态组合条件、排序或结构的查询才可在实现中构造 SQL，并必须集中封装、参数化和测试。
- 测试 seed 必须沿用当前 AUX → DCL → BOB 读验证 → VOU/WFL → ACC 依赖链且保持幂等。`seed-bob` 是历史命令名，实际经 DCL 写入并由 BOB 读验证；生产数据初始化以后单独设计，不得由测试样本反向决定运行时依赖或公共适配器设计。

## 业务域文档

- 领域任务先读取根 `CONTEXT.md` 和对应的 `docs/domains/<domain>.md`；路径、触发规则和索引以根 `AGENTS.md`、[领域文档规则](../docs/agents/domain.md)及根 README 为准。

新增业务域时，先补充根目录 `docs/domains/<domain>.md`，再实现对应路由、权限、数据库基线和领域代码。
