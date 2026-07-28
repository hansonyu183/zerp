# 开发、PR 与自动上线规范

本规范覆盖从可验收提交到正式上线的完整路径。代码和配置只能从受保护的 `main` merge commit 上线；固定预览和生产发布不得构建包含未提交修改的开发工作区。

## 1. 开发与推送

每项工作使用独立分支或工作树，形成可验收提交后执行：

```bash
make pre-push
```

有应用影响的变更继续执行：

```bash
make preview-deploy PREVIEW_REF=HEAD
make preview-status
```

`pre-push` 要求工作树干净，并按 `scripts/change-impact.sh` 分层：

- 文档变更运行差异、格式和文档完整性检查；
- 本地门禁、文档检查器和 CI 工作流等验证工具变更，额外运行 Shell、Actionlint 和门禁行为检查；
- 应用、契约、依赖、构建、数据库、运行配置及发布脚本等应用影响变更，运行生成检查、前后端质量门禁和隔离全栈 E2E，并发布固定预览供人工验收。

任何失败都必须修复并形成新提交，不得推送红色分支。PR CI 使用相同分类，保留原有必需检查名，但文档和验证工具变更不启动无关的前后端、容器或 E2E 重任务。

本地 E2E 按后端与 Web 的真实构建输入分别计算指纹，复用未变化一侧的已标记镜像；需要排除缓存时运行 `E2E_FORCE_REBUILD=1 make e2e`。CI 使用 BuildKit 的 GitHub Actions 层缓存，并把桌面和手机 Playwright 项目放在两个隔离 runner 上并行执行；最终仍汇总为原有的 `e2e` 必需检查。

本地门禁及适用的预览验收通过后，推送分支并创建草稿 PR。PR 必须直接以 `main` 为基线和目标；有依赖的后续分支等前置 PR 合并后基于最新 `main` 重放，再创建新的 PR，禁止堆叠 PR。CI 会先校验目标分支、当前 `main` ancestry、其他未合并 PR head 和变更影响，再决定是否启动重任务。

PR 的 `contracts`、`frontend`、`backend`、`containers` 和 `e2e` 必须全部成功，之后才可人工合并。`backend` 内部将生成检查、测试/竞态检查和静态/安全检查并行执行，再汇总为原有的必需检查名。禁止直接推送、强推或自动合并 `main`。

合并后不重复运行整套质量与 E2E。main 门禁通过 GitHub API 验证合并提交与 PR head 的 Git tree 完全一致，并复用该 PR 的五项成功检查；树不一致、不是关联 PR 合并提交或任一检查缺失时立即失败。main 仍保留原有五个检查名，兼容分支保护和现有生产发布代理。

## 2. 自动上线

正式环境由同一 merge commit 统一发布：

1. Cloudflare Pages Git 集成构建并发布同一 `main` commit；
2. 本机发布代理确认 `main` 已复用的五项 PR 检查和 `Cloudflare Pages` 全部成功；
3. 从独立干净仓库构建带完整 commit SHA 的 API、migrate、Web 镜像和前端产物；
4. 备份 PostgreSQL、附件及上一版发布清单；
5. 运行向后兼容的 Goose migration；
6. 更新本机 `zerp-back` API 与 Web，验证本机和公网健康；
7. 验证 Pages 的精确 commit 标记、`https://zerp.bytesucceed.com` 与 `https://zerp-api.bytesucceed.com`，并写回 GitHub Production Deployment 状态。

发布代理是用户级 launchd 服务，每 60 秒检查一次 `origin/main`。Mac 离线或未登录时发布保持排队，Colima 恢复后继续。纯文档或 CI 配置提交记录为成功 no-op，不重建应用；代理单独记录已处理提交，`current-sha` 始终指向最后一次成功发布的应用版本。

## 3. 生产隔离与凭证

- Production Compose 项目固定为 `zerp-back`，环境文件固定为 `backend/.env.production.local`，权限必须为 `600`。
- 开发、E2E、固定预览和生产必须使用不同 Compose 项目、端口、数据库、卷和 Cookie。
- Cloudflare Pages 继续复用仓库现有 Git 集成，不新增、不复制 Pages API Token。
- 发布备份保存在被 Git 忽略的 `backend/var/production/releases/`，保留最近七次成功版本。

## 4. 失败与回滚

构建、备份或 migration 失败时不更新应用。Pages 失败会在本机发布前阻断流程；API rollout 或公网健康检查失败时，发布代理自动恢复上线前的应用镜像并标记 GitHub Deployment 失败。

同一 main SHA 首次发布失败后，发布代理写入失败标记并停止自动重试，避免确定性错误每分钟重复构建、备份和迁移。修复外部状态并完成必要的数据确认后，运行 `make production-retry` 清除该 SHA 的熔断标记并立即重试；新的 main SHA 不受旧失败标记影响。

数据库不得自动执行 down migration，也不得自动恢复备份，以免覆盖上线后的业务写入。所有 migration 必须兼容上一版应用；数据库恢复只能在明确停写和人工确认后执行。

人工回滚到已验证版本：

```bash
make production-rollback PRODUCTION_REF=<full-commit-sha>
make production-status
```

该命令只切换本机应用镜像，不修改 Pages 或数据库。需要回退前端时，通过 revert PR 恢复 `main`；Cloudflare Pages 与本机代理会按新 merge commit 自动完成协调发布。

## 5. 安装与验收

首次安装前准备生产环境文件，然后运行：

```bash
scripts/install-production-agent.sh
make production-status
```

验收必须覆盖：直接推送 `main` 被拒绝、失败检查阻止合并、精确 SHA 预览不包含脏工作区、合并后自动发布、数据库和附件备份、应用失败自动回滚，以及本机、公网和 `al-sz-root` 健康探测。
