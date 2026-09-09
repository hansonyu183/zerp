# APP/AUX 直接维护验收（#409）

- 实现 SHA：`bc007b898100f81030950c4d43ebb69757effb59`。
- 范围：十二个已登记 APP/AUX 资源；[ADR-0060](../adr/0060-dynamic-page-runtime.md) 与 [APP-DIRECT-01](../use-cases/app/navigation.md#app-direct-01-统一直接维护)。本次没有生产部署、业务数据迁移或 HTTP/数据库契约变更。
- 独占环境：Compose project `zerp-issue-409`，PostgreSQL/API/Web 端口 `55449/18092/18093`；数据库 `zerp_target_test`。浏览器只连接本次可丢弃环境。

## 验收结果

| 命令                                                                                                                                          | 退出码 | 证据                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| `make target-e2e`（上述独占端口及 Compose project）                                                                                           | 1      | 生成、类型、静态、构建、模型、前端和 API 测试已通过；随后 Docker 构建访问 npm 出现 EAI_AGAIN，未把此聚合命令记为成功 |
| `docker compose -p zerp-issue-409 -f compose.target.yaml -f .scratch/issue-409/build-network.yaml up -d --build --wait target-api target-web` | 0      | 临时构建网络覆盖恢复 npm 访问，API/Web/DB 均健康；没有修改共享 Docker 配置                                           |
| `pnpm --filter @zerp/frontend typecheck`                                                                                                      | 0      | 最终类型检查，包含 definition 的负向类型约束                                                                         |
| `pnpm --filter @zerp/frontend lint`                                                                                                           | 0      | 最终静态检查                                                                                                         |
| `pnpm --filter @zerp/frontend test:unit`                                                                                                      | 0      | 34 文件 183 项，加真实 Vuetify 配置 10 项，合计 193 项                                                               |
| `pnpm --filter @zerp/api e2e`                                                                                                                 | 0      | 最终完整浏览器 27/27，覆盖桌面与 390px                                                                               |
| `pnpm --filter @zerp/api e2e:wfl`                                                                                                             | 0      | WFL 浏览器 1/1                                                                                                       |
| `pnpm --filter @zerp/api e2e:vou-catalog`                                                                                                     | 0      | 全凭证目录浏览器 2/2                                                                                                 |
| `pnpm --filter @zerp/api e2e:vou-opening`                                                                                                     | 0      | 期初凭证浏览器 2/2；Vite 输出 ResizeObserver 通知，测试通过                                                          |
| `make check-common check-ci-workflow`                                                                                                         | 0      | 格式、文档、ADR 双向关系、差异及 CI 编排检查                                                                         |

初次完整浏览器为 23 通过、4 失败；修复真实字段标签、共享校验反馈及禁用保存按钮的断言后，最终 27 项全部通过。后端未发生变更，复用本候选已通过的 API 单元 81、持久化 19、集成 86 和迁移 6 项证据；模型 31 项通过。

环境参数使用 `TARGET_POSTGRES_PORT=55449 TARGET_API_PORT=18092 TARGET_WEB_PORT=18093 TARGET_API_BROWSER_URL=http://127.0.0.1:18092 TARGET_CORS_ALLOWED_ORIGINS=http://127.0.0.1:18093`。数据库连接通过进程环境传递，不在记录内保存连接串。完整浏览器使用 `TARGET_DATABASE_URL`、`TARGET_API_BASE_URL`、`TARGET_WEB_BASE_URL`；后三项顺序运行，使用 `TARGET_TEST_DATABASE_URL` 与 `TARGET_DATABASE_SCOPE=isolated`。

## 公开入口与行为证据

- 十二个真实 definition 经 Registry/ResourceHost 到公共 DirectPage，测试从用户操作断言类型化 API 输入；没有暴露私有状态作为测试入口。类型与架构检查限制 definition 的字段、适配器及导入，旧页面 VM、转发包装、模板和专属测试已删除。
- 覆盖全部资源保存映射、引用完整分页和独立加载、停用/不可分配关联、车辆条件归属、零值、空值、false 与十进制精度，以及原有启停/删除动作。
- 回归覆盖取消读取后新建、候选权限不足、未知写入后的显式只读核实、核实迟到不污染另一编辑对象、写成功刷新失败、重复提交、资源/Session 隔离及缺 query 权限时不读取。

## 独立审查

- Standards：依据全仓/前端 AGENTS 与 code-review smell baseline 审查；发现的加载状态问题已修复并补公开入口回归，无未解决项。
- Spec：依据 #408/#409 审查；未知写入核实及迟到结果隔离问题已修复并补回归，无未解决项。

## 资源回收

`TARGET_POSTGRES_PASSWORD=<进程内临时值> docker compose -p zerp-issue-409 -f compose.target.yaml down --volumes --remove-orphans` 退出 0。三个容器、网络及附件卷已删除；本次构建的两个项目镜像已删除。专项脚本已关闭临时 API/Web 并回滚 fixture 事务。回读没有项目容器、网络、数据卷，三个独占端口没有监听，专项脚本没有残留进程。未终止共享的 `zerp-back` 服务或清理共享缓存。
