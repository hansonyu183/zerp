# ZERP Backend

ZERP 后端是单仓中的 Go API，负责领域服务、权限校验、事务、PostgreSQL 持久化、附件和运行状态端点。HTTP 线协议以根目录 OpenAPI 为准，业务规则以根目录领域文档为准。

## 模块运行

统一环境、配置和完整开发环境按[根 README](../README.md)启动。在已就绪的本地依赖上，可在 `backend/` 目录运行 `make run` 单独启动 API。

服务默认监听 `http://localhost:8080`；可用以下端点检查进程和数据库就绪状态：

```bash
curl http://localhost:8080/healthz
curl http://localhost:8080/readyz
```

API 在开始监听前同步 APP 菜单路由目录与业务菜单。同步在单个数据库事务中执行，没有目录变化时保持幂等；数据库、菜单设置或同步写入失败都会令进程启动失败，不会退回到请求期同步。

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

容器编排统一由仓库根目录的 `compose.yaml` 及其 dev、e2e、production override 管理。容器化 API 不得与占用同一端口的 `make run` 同时使用。

## 文档导航

- [后端工程约束](AGENTS.md)：目录组织、领域边界、事务、数据库、测试与部署规则
- [根 README](../README.md)：统一环境、启动、公共工具链、契约开发与部署方式
- [领域与页面用例](../README.md#文档)
- [前端 API 配置](../docs/operations/frontend-api-configuration.md)
- [环境变量模板](.env.example)

## License

MIT，见根目录 [LICENSE](../LICENSE)。
