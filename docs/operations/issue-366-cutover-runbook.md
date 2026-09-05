# #366 开发测试环境总切换

## 范围

当前公网环境用于开发测试。#366 不迁移旧 Go 数据，不保留兼容读取、双写、代理或旧状态；旧数据库与附件快照只用于整次回滚。切换时停止旧 API，直接重建同名 PostgreSQL 数据库为 `apps/api/db/target-schema.sql`，创建首个 target 管理员，再启动唯一的 Hono API 并发布 target SPA。

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
6. 仅在 `app_users` 为空时运行 `pnpm --filter @zerp/api bootstrap:admin` 创建首个 `superadmin`。该命令重复执行必须失败，不能覆盖账号。
7. 启动目标 API，等待 `/healthz` 和 `/readyz`；随后发布同一 SHA 的 target SPA。

## 验收

1. API 和 Web 的 release marker 均为批准的完整 SHA。
2. 使用新管理员登录，验证会话、CSRF 与权限目录。
3. 验证 APP Workbench 以及代表性的 DCL、VOU、ACC、WFL、RPT 读写。
4. 数据库只包含 target schema；Approval 状态只允许 `PENDING`、`APPROVED`、`REJECTED`。
5. 公网 API 不再由 Go 进程处理，仓库中不存在旧 OpenAPI、Go 服务或旧前端入口。

## 整体回滚

如果目标验收失败，停止 target API，删除并重建同名数据库，恢复切换前 dump 与附件归档，使用轮换后的数据库口令启动已记录的旧 API 镜像，并在健康、登录和代表性读取恢复后重新开放。不得做局部反向转换。
