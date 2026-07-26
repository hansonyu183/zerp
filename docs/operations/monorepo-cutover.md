# ZERP 单仓切换运行手册

## 目标与边界

本手册只覆盖从原前端仓库与 `zerp-back` 后端仓库切换到本仓库的工程步骤。当前阶段不得执行生产部署、DNS 变更、旧仓库归档或默认分支冻结；这些动作必须等待新单仓在隔离环境完成迁移、健康检查和真实流程验收。

切换前的可恢复基线：

- 原前端提交：`e4f154e`，标签 `pre-monorepo-2026-07-26`
- 原后端提交：`9e99268`，标签 `pre-monorepo-2026-07-26`
- 后端历史通过非 squash subtree 保留在 `backend/`

## 预切换门禁

合并单仓分支前必须全部满足：

1. `make generate-check` 无生成漂移。
2. `make check`、`make test`、`make build` 通过。
3. `docker compose --env-file backend/.env.example config --quiet` 与隔离 E2E Compose 配置通过。
4. 使用专用测试数据库运行 `make e2e`；不得连接生产或日常联调数据库。
5. `web`、`api`、`db` 健康，`migrate` 成功退出，浏览器只通过 Web 同源入口访问 `/api/` 与 `/files/`。
6. OpenAPI 路由覆盖测试、请求校验测试和前端生成路径类型检查通过。

## 隔离验证

```bash
cp backend/.env.e2e.example backend/.env.e2e.local
make e2e
```

E2E 编排必须使用项目名 `zerp-fullstack-e2e`、数据库 `zerp_e2e`、端口 `55435/18081/15174`、专用 Cookie 名称，并固定关闭 GitHub 反馈发布。清理命令只能删除该 Compose 项目的容器与卷。

生产形态镜像验证：

```bash
docker compose --env-file backend/.env.example config --quiet
docker compose --env-file backend/.env.example build web api migrate
```

`.env.local`、`.env.e2e.local`、附件、数据库卷、测试账号和任何 Token 均不得提交。

## 合并与上线顺序

1. 以 Draft PR 合并工程变更，保留完整测试证据与环境阻塞。
2. 合并后重新从 `main` 运行生成、前后端门禁、镜像构建和隔离 E2E。
3. 在非生产环境部署同一镜像，核验数据库迁移、`/healthz`、`/readyz`、登录、附件和 APP/BOB/VOU/WFL/LED 关键流程。
4. 单独制定生产变更窗口、数据库备份/回滚和入口切换方案。
5. 生产验证稳定后，才允许更新旧仓库 README 并评估归档。

## 旧 `zerp-back` README 指针草案

旧仓库在新栈真正上线前保持可用且不归档。上线验收完成后，可将旧 README 顶部更新为：

> ZERP 后端已并入 `hansonyu183/zerp` 的 `backend/` 目录。本仓库仅保留历史，不再接收功能变更；请在新单仓提交 Issue 和 Pull Request。

在生产切换完成前，不提交上述指针，不关闭旧仓库 Issue，不修改 DNS。

## 回滚

- 工程回滚：恢复到两个 `pre-monorepo-2026-07-26` 标签继续独立构建。
- 应用回滚：部署切换前镜像；不得仅回滚代码而保留不兼容数据库结构。
- 数据库回滚：只执行已在备份副本验证过的 Goose 回滚步骤；先停止写流量并保留快照。
- 入口回滚：恢复切换前反向代理或 DNS 配置，并再次核验旧前后端健康。

任何回滚都必须记录触发原因、数据库版本、镜像摘要和验证结果。
