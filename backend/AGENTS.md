# ZERP 后端工程约束

## 文件系统边界

- 本项目目录以当前 Git 工作区根目录 `/Users/hansonyu/code/zerp-back` 为准。
- 只允许在本项目目录内创建、修改、覆盖、删除或移动文件；不得将文件复制到本项目目录外。
- 不得通过符号链接、包含 `..` 的相对路径或其他路径跳转方式绕过上述边界。
- 项目目录外仅允许只读检查。Go 工具链、依赖管理器和测试程序可以使用其自动管理的临时目录与缓存，但不得主动编辑其中的文件。
- 如果任务确实需要修改项目目录外的文件，必须立即停止相关操作并向用户说明，不得自行扩大操作范围。

## 工程约定

- 跨领域工程规则以 [README](README.md) 为准，具体业务规则以对应领域文档为准；契约冲突时先统一文档，再修改实现。
- 后端使用 Go、Gin、pgx 和 sqlc；数据库结构变更统一使用 Goose SQL 迁移。
- 业务接口统一使用 `POST application/json`，路径格式为 `/{domain}/{entity}/{action}`，响应包络为 `{code, message, data, requestId}`。
- 事务边界由领域用例控制；Handler 仅负责协议适配、参数校验和响应转换，不承载业务规则。
- 查询 SQL 写入 `db/queries/`，迁移写入 `db/migrations/`。修改后执行 `make generate`，不得手工编辑 `internal/database/sqlc/` 下的生成代码。
- 不得提交密码、Cookie、CSRF Token、数据库连接信息或其他凭证；日志同样不得记录这些敏感信息。
- 代码变更至少通过 `make generate`、`make test` 和 `go vet ./...`；涉及运行环境时额外验证 Docker Compose 服务及健康检查。

## 业务域文档

- [APP：应用访问与权限](docs/domains/app.md)
- [BOB：基础业务对象](docs/domains/bob.md)
- [VOU：业务单据](docs/domains/vou.md)
- [WFL：业务流程](docs/domains/wfl.md)
- [LED：业务账簿](docs/domains/led.md)

新增业务域时，先补充 `docs/domains/<domain>.md`，再实现对应路由、权限、迁移和领域代码。
