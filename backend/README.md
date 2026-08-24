# ZERP Backend

ZERP 后端是单仓中的 Go API，负责领域服务、权限校验、事务、PostgreSQL 持久化、附件和运行状态端点。HTTP 线协议以根目录 OpenAPI 为准，业务规则以根目录领域文档为准。

## 环境与启动

- Go 1.26.6
- Gin、pgx、sqlc、Goose
- PostgreSQL 18、Docker Compose v2、GNU Make

sqlc 和 Goose 锁定在 `tools` Go 模块中，无需全局安装。

从仓库根目录启动完整开发环境：

```bash
cp backend/.env.example backend/.env.local
make bootstrap
make dev
```

仅运行后端：

```bash
cd backend
docker compose --env-file .env.local -f ../compose.yaml -f ../compose.dev.yaml up -d --wait db
make migrate-up
make run
```

服务默认监听 `http://localhost:8080`；可用以下端点检查进程和数据库就绪状态：

```bash
curl http://localhost:8080/healthz
curl http://localhost:8080/readyz
```

## 常用命令

在 `backend/` 目录运行：

| 命令                    | 用途                           |
| ----------------------- | ------------------------------ |
| `make run`              | 启动本机 Go 服务               |
| `make build`            | 编译全部 Go 包                 |
| `make test`             | 执行单元测试和数据库集成测试   |
| `make test-unit`        | 执行不依赖数据库的测试         |
| `make test-integration` | 在独立测试库运行领域数据库测试 |
| `make generate`         | 生成 sqlc 代码                 |
| `make quality`          | 运行后端完整质量检查           |
| `make migrate-status`   | 查看迁移状态                   |
| `make migrate-up`       | 应用全部迁移                   |
| `make migrate-down`     | 回滚一个迁移版本               |

容器编排统一由仓库根目录的 `compose.yaml` 及其 dev、e2e、production override 管理；启动和停止完整容器环境使用根目录 `make compose-up`、`make compose-down`。

## 文档导航

- [后端工程约束](AGENTS.md)：目录组织、领域边界、事务、数据库、测试与部署规则
- [根 README](../README.md)：统一环境、命令、契约开发与部署方式
- [领域与页面用例](../README.md#文档)
- [前端 API 与双部署配置](../docs/operations/frontend-api-configuration.md)
- [环境变量模板](.env.example)

## License

MIT，见根目录 [LICENSE](../LICENSE)。
