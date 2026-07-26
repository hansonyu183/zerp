# ZERP 后端工程约束

## 文件系统边界

- 本模块位于 `backend/`，共享契约、领域文档、运行环境和全仓门禁以根目录 `AGENTS.md`、`README.md` 为准。
- 纯后端任务默认只修改 `backend/`；跨端契约任务按根规则同时修改 OpenAPI、后端适配、前端调用和测试。

## 工程约定

- 后端使用 Go、Gin、pgx 和 sqlc；数据库结构变更统一使用 Goose SQL 迁移。
- 事务边界由领域用例控制；Handler 仅负责协议适配、参数校验和响应转换，不承载业务规则。
- 查询 SQL 写入 `db/queries/`，迁移写入 `db/migrations/`。修改后执行 `make generate`，不得手工编辑 `internal/database/sqlc/` 下的生成代码。
- 代码变更至少通过 `make generate`、`make test` 和 `go vet ./...`；涉及运行环境时额外验证 Docker Compose 服务及健康检查。

## 业务域文档

- [APP：应用访问与权限](../docs/domains/app.md)
- [BOB：基础业务对象](../docs/domains/bob.md)
- [VOU：业务单据](../docs/domains/vou.md)
- [WFL：业务流程](../docs/domains/wfl.md)
- [LED：业务账簿](../docs/domains/led.md)

新增业务域时，先补充根目录 `docs/domains/<domain>.md`，再实现对应路由、权限、迁移和领域代码。
