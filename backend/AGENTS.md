# ZERP 后端工程约束

## 文件系统边界

- 本模块位于 `backend/`，共享契约、领域文档和运行环境以根目录 `AGENTS.md`、`README.md` 为准。
- 纯后端任务默认只修改 `backend/`；跨端契约任务按根规则同时修改 OpenAPI、后端适配、前端调用和测试。

## 工程约定

- 后端使用 Go、Gin、pgx 和 sqlc；数据库结构变更统一使用 Goose SQL 迁移。
- sqlc 和 Goose 锁定在 `tools` Go 模块中，不得改用全局安装的工具版本。
- 事务边界由领域用例控制；Handler 仅负责协议适配、参数校验和响应转换，不承载业务规则。
- 事务内领域事件的订阅者必须复用发布者的同一个 `pgx.Tx` 并同步执行；任一订阅失败时整体回滚，订阅期间不得产生外部网络、文件、异步任务等不可回滚副作用。
- 查询 SQL 写入 `db/queries/`，迁移写入 `db/migrations/`。修改后执行 `make generate`，不得手工编辑 `internal/database/sqlc/` 下的生成代码。
- 新增迁移必须补齐 `db/migration-tests/<最新版本>_before.sql` 和 `_after.sql` 升级夹具，并运行 `make test-migration-upgrade`。
- 开发期至少运行与变更相关的生成、测试和静态检查；涉及运行环境时额外验证 Docker Compose 服务及健康检查。

## 目录组织与运行安全

- `cmd/` 放服务和运维命令入口；`db/migrations/` 放 Goose 迁移，`db/queries/` 放 sqlc 查询；`internal/api/` 放生成协议类型、中间件和统一响应适配；`internal/config/` 解析和校验环境变量；`internal/database/` 放 pgx 与 sqlc 生成代码；`internal/domains/` 放领域服务、Handler 和类型；`internal/httpserver/` 放路由和健康检查；`internal/seed/` 放非生产数据初始化。
- 应用只读取环境变量。Make 和 Compose 默认使用 `.env.local`，也可通过 `ENV_FILE` 指定受控环境文件；模板为 `.env.example`。凭证只能进入受控环境变量或密钥系统，不得写入仓库、命令行参数或日志。
- 生产必须显式配置数据库、附件目录、Cookie、Origin 和反馈发布凭证。生产迁移必须作为明确部署步骤执行；本地持久附件目录只支持单实例 API，且必须与数据库共同备份和恢复。
- `make compose-up` 启动容器化 API 和 PostgreSQL，不得与占用同一 API 端口的 `make run` 同时使用。
- `make test` 必须使用独立的 `zerp-api-test` Compose 项目和测试数据库；测试数据库名必须以 `_test` 结尾，且不得与主数据库或端口冲突。完整 E2E 必须使用根目录 `make e2e` 创建的隔离环境，不得连接生产或普通开发库。
- 完整 E2E 固定拒绝生产环境、非隔离数据库、错误端口和启用 GitHub 反馈发布的配置；结束后必须清理一次性数据库容器和本机进程。
- `make bootstrap-admin` 只能用于空用户库；`make seed-bob` 只允许在 `development` 或 `test` 环境运行。`make seed-test` 只能写入隔离 E2E 测试实例，普通开发和生产库必须在写入前拒绝；它必须保持幂等，只恢复自身中断的步骤，不覆盖测试人员已修改或推进的样本。

## 模块边界与公共复用

- 领域 Service 必须在构造完成时即可安全使用；不可缺少的仓储、事件总线、跨域能力和转换器必须由构造函数显式注入，禁止依赖后置 Setter、空占位接口或调用顺序补齐必需依赖。
- 领域包保留业务规则和自身模型。两个领域之间稳定、无业务决策的类型映射或引用解析放在 `internal/integrations/<purpose>/`，由适配器明确依赖方向；不得在 `httpserver`、seed 或多个领域包中复制同一转换逻辑。
- `internal/platform/` 只接收确定为领域无关的基础能力。公共工具应具备稳定语义、清晰边界并至少被多个领域复用；金额精度、状态含义、默认值等领域决策不得为了消除少量重复而下沉成通用函数。
- 固定形状、可命名的查询必须写入 `db/queries/` 并通过 sqlc 调用；只有确实需要动态组合条件、排序或结构的查询才可在实现中构造 SQL，并必须集中封装、参数化和测试。
- 测试 seed 必须沿用当前 AUX → BOB → VOU/WFL → ACC 领域边界且保持幂等；生产数据初始化以后单独设计，不得由测试样本反向决定运行时依赖或公共适配器设计。

## 业务域文档

- 领域任务先读取根 `CONTEXT.md` 和对应的 `docs/domains/<domain>.md`；路径、触发规则和索引以根 `AGENTS.md`、[领域文档规则](../docs/agents/domain.md)及根 README 为准。

新增业务域时，先补充根目录 `docs/domains/<domain>.md`，再实现对应路由、权限、迁移和领域代码。
