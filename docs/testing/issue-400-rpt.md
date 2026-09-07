# #400 RPT 当前定义验证

2026-09-07，直接使用授权的 zerp 数据库完成分项验证，未运行会重建数据库的聚合命令，未恢复 CI 或部署。

- `generate:artifacts`、`generate:db`：从可执行 Hono/Zod 契约与实际转换后的 schema 生成，生成物由格式化工具规范化。
- API、api-client、model、frontend 的 `typecheck`；前端 `lint` 与 `build:target`：通过。
- API 单元 78 项、生成/契约检查 19 项、model 单元 31 项、前端单元及真实 Vuetify 组件 202 项：通过。
- 数据库分项执行 `rpt-core`、`rpt-migration`、`archive-lifecycle`、`acc-wfl-http`：12 项通过。覆盖当前定义/CAS、零行列契约、精确 HTTP 权限、旧路由删除、大金额与日期、多参数导出、失效恢复，以及受影响 BOB/ACC/WFL 消费者。
- 迁移回归采用仓库既有回滚事务模式：共享行保留在临时改名表中，DDL 与样例全部回滚。验证最高批准、开放 V1、未决候选 blocker、历史审计、缺枚举显示名的无效配置、只读授权转换及不授予 save。
- 真实 Playwright `rpt.spec.ts`：2 项通过。多参数查询、快照翻页、CSV 内容、390px 布局、刷新销毁输入，以及仅导出账号不发查询、不显示维护动作。
- 文档、格式与 `git diff --check`：通过。

独立 Standards 和 Spec 审查提出的问题已修复并复核，无剩余发现。

本次实际转换的原报表定义为 0 条。测试结束后回读确认测试账号、测试报表、临时改名表均为 0；关闭本次临时 API、Vite 和浏览器资源，保留共享数据库与服务。配置维护 API 可在报表失效时继续用于修正，readiness 仍对启用的 INVALID 定义保持失败。
