# 开发、PR 与自动上线规范

本规范覆盖从可验收提交到正式上线的完整路径。业务代码只能从受保护的 `main` merge commit 上线；固定预览和生产发布不得构建包含未提交修改的开发工作区。

## 1. 开发与推送

每项工作使用独立分支或工作树，形成可验收提交后执行：

```bash
make pre-push
make preview-deploy PREVIEW_REF=HEAD
make preview-status
```

`pre-push` 要求工作树干净。纯文档变更只运行格式和差异检查；其他变更运行生成检查、前后端质量门禁和隔离全栈 E2E。任何失败都必须修复并形成新提交，不得推送红色分支。

预览验收通过后推送分支并创建草稿 PR。PR 的 `contracts`、`frontend`、`backend`、`containers` 和 `e2e` 必须全部成功，之后才可人工合并。禁止直接推送、强推或自动合并 `main`。

## 2. 自动上线

正式环境由同一 merge commit 统一发布：

1. 本机发布代理确认 `main` 的五项检查全部成功；
2. 从独立干净仓库构建带完整 commit SHA 的 API、migrate、Web 镜像和前端产物；
3. 备份 PostgreSQL、附件及上一版发布清单；
4. 运行向后兼容的 Goose migration；
5. 更新本机 `zerp-back` API 与 Web，验证本机和公网健康；
6. 将同一 commit 的前端产物上传到 Cloudflare Pages 项目 `zerp`；
7. 验证 `https://zerp.bytesucceed.com` 与 `https://zerp-api.bytesucceed.com`，并写回 GitHub Production Deployment 状态。

发布代理是用户级 launchd 服务，每 60 秒检查一次 `origin/main`。Mac 离线或未登录时发布保持排队，Colima 恢复后继续。纯文档或 CI 配置提交记录为成功 no-op，不重建应用。

## 3. 生产隔离与凭证

- Production Compose 项目固定为 `zerp-back`，环境文件固定为 `backend/.env.production.local`，权限必须为 `600`。
- 开发、E2E、固定预览和生产必须使用不同 Compose 项目、端口、数据库、卷和 Cookie。
- Cloudflare Pages Token 只授予目标账户的 Pages 发布权限，保存在本机凭证目录，禁止写入仓库、日志或 launchd plist。
- 发布备份保存在被 Git 忽略的 `backend/var/production/releases/`，保留最近七次成功版本。

## 4. 失败与回滚

构建、备份或 migration 失败时不更新应用。API rollout、Pages 上传或公网健康检查失败时，发布代理自动恢复上线前的应用镜像并标记 GitHub Deployment 失败。

数据库不得自动执行 down migration，也不得自动恢复备份，以免覆盖上线后的业务写入。所有 migration 必须兼容上一版应用；数据库恢复只能在明确停写和人工确认后执行。

人工回滚到已验证版本：

```bash
make production-rollback PRODUCTION_REF=<full-commit-sha>
make production-status
```

回滚只切换应用镜像和对应前端产物，不修改数据库。

## 5. 安装与验收

首次安装前准备生产环境文件和最小权限 Cloudflare Pages Token，然后运行：

```bash
scripts/install-production-agent.sh
make production-status
```

验收必须覆盖：直接推送 `main` 被拒绝、失败检查阻止合并、精确 SHA 预览不包含脏工作区、合并后自动发布、数据库和附件备份、应用失败自动回滚，以及本机、公网和 `al-sz-root` 健康探测。
