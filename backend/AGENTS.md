# ZERP 后端工程约束

## 文件系统边界

- 本模块位于 `backend/`，共享契约、领域文档、运行环境和全仓门禁以根目录 `AGENTS.md`、`README.md` 为准。
- 纯后端任务默认只修改 `backend/`；跨端契约任务按根规则同时修改 OpenAPI、后端适配、前端调用和测试。

## 工程约定

- 后端使用 Go、Gin、pgx 和 sqlc；数据库结构变更统一使用 Goose SQL 迁移。
- 事务边界由领域用例控制；Handler 仅负责协议适配、参数校验和响应转换，不承载业务规则。
- 事务内领域事件的订阅者必须复用发布者的同一个 `pgx.Tx` 并同步执行；任一订阅失败时整体回滚，订阅期间不得产生外部网络、文件、异步任务等不可回滚副作用。
- 查询 SQL 写入 `db/queries/`，迁移写入 `db/migrations/`。修改后执行 `make generate`，不得手工编辑 `internal/database/sqlc/` 下的生成代码。
- 开发期至少运行与变更相关的生成、测试和静态检查；涉及运行环境时额外验证 Docker Compose 服务及健康检查。形成可验收提交后按根规则运行 `make pre-push`。

## 模块边界与公共复用

- 领域 Service 必须在构造完成时即可安全使用；不可缺少的仓储、事件总线、跨域能力和转换器必须由构造函数显式注入，禁止依赖后置 Setter、空占位接口或调用顺序补齐必需依赖。
- 领域包保留业务规则和自身模型。两个领域之间稳定、无业务决策的类型映射或引用解析放在 `internal/integrations/<purpose>/`，由适配器明确依赖方向；不得在 `httpserver`、seed 或多个领域包中复制同一转换逻辑。
- `internal/platform/` 只接收确定为领域无关的基础能力。公共工具应具备稳定语义、清晰边界并至少被多个领域复用；金额精度、状态含义、默认值等领域决策不得为了消除少量重复而下沉成通用函数。
- 固定形状、可命名的查询必须写入 `db/queries/` 并通过 sqlc 调用；只有确实需要动态组合条件、排序或结构的查询才可在实现中构造 SQL，并必须集中封装、参数化和测试。
- 预览与 E2E seed 必须沿用当前 AUX → BOB → VOU/WFL → LED 领域边界且保持幂等；生产演示的历史兼容路径必须隔离在专用 seed 中，不得反向决定运行时依赖或公共适配器设计。

## 业务域文档

- [APP：应用访问与权限](../docs/domains/app.md)
- [BOB：基础业务对象](../docs/domains/bob.md)
- [AUX：辅助对象](../docs/domains/aux.md)
- [VOU：业务单据](../docs/domains/vou.md)
- [WFL：业务流程](../docs/domains/wfl.md)
- [LED：业务账簿](../docs/domains/led.md)

新增业务域时，先补充根目录 `docs/domains/<domain>.md`，再实现对应路由、权限、迁移和领域代码。
