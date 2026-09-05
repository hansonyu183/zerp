# #366 开发测试环境总切换

> 状态：#366 已于 2026-09-05 完成。以下内容保留为当时的执行记录与整次回滚依据，不是日常数据库重建流程。

## 范围

当前公网环境用于开发测试。#366 不迁移旧 Go 数据，不保留兼容读取、双写、代理或旧状态；旧数据库与附件快照只用于整次回滚。切换时停止旧 API，直接重建同名 PostgreSQL 数据库为 `apps/api/db/target-schema.sql`，从受控凭证文件创建两个线上测试用户，再启动唯一的 Hono API 并发布 target SPA。

## 切换前

1. 记录旧 API/Web 的完整 SHA 和镜像 ID。
2. 确认目标合并 SHA 已通过 `make e2e`。
3. 确认现有数据库 dump 与附件归档可读，并记录 SHA-256。
4. 构建目标 SHA 的 API 与 Web 镜像。

## 重建与切换

1. 停止旧 API，确认没有其他 writer 或共享进程连接业务库。
2. 强制断开同名数据库连接，删除并重新创建数据库。
3. 将 `apps/api/db/target-schema.sql` 应用到空库；不要执行旧数据 transform。
4. 轮换 PostgreSQL 口令，并同步本地生产环境文件。
5. 运行 `pnpm --filter @zerp/api sync:catalog` 同步生成的 Hono 权限目录。
6. 运行 `pnpm --filter @zerp/api seed:online-test`，从 `APP_TEST_ADMIN_PASSWORD_FILE` 和 `APP_TESTER_PASSWORD_FILE` 创建或校准固定用户 `test-admin`、`tester`。两者必须启用、无需首次改密并拥有 `superadmin`；重复执行应更新凭证哈希并撤销旧会话。
7. `compose.production.yaml` 必须让 API 等待权限目录同步和线上测试用户种子成功；随后等待 `/healthz` 和 `/readyz`，并发布同一 SHA 的 target SPA。

## 验收

1. API 和 Web 的 release marker 均为批准的完整 SHA。
2. 使用凭证目录中的两套账号分别登录，验证业务响应码为成功，并验证会话、CSRF 与权限目录。
3. 验证 APP Workbench 以及代表性的 DCL、VOU、ACC、WFL、RPT 读写。
4. 数据库只包含 target schema；Approval 状态只允许 `PENDING`、`APPROVED`、`REJECTED`。
5. 公网 API 不再由 Go 进程处理，仓库中不存在旧 OpenAPI、Go 服务或旧前端入口。

## 整体回滚

如果目标验收失败，停止 target API，删除并重建同名数据库，恢复切换前 dump 与附件归档，使用轮换后的数据库口令启动已记录的旧 API 镜像，并在健康、登录和代表性读取恢复后重新开放。不得做局部反向转换。
