# 本地 Issue 批次自动交付

本流程面向单人、单台受信任 Mac。它不使用远端 Issue 队列、implementer/reviewer GitHub Apps 或定时轮询；多人协作需要另立工作流，不在这里保留兼容分支。

## 完整流程

1. `$to-tickets` 在主工作区生成 `.scratch/<feature>/issues/*.md`。整个目录是一项不可拆分的发布批次。
2. launchd 通过 `WatchPaths` 发现 `ready-for-agent` 批次，控制器领取整批并创建 `automation/local-<feature>` 独立 worktree。
3. 控制器为整批而非逐 ticket 启动临时 `codex exec`，明确要求使用 `$implement` 处理整个目录。`$implement` 负责 TDD、聚焦测试、一次最终全量门禁、`/code-review`、修复和提交；只有失败修复轮次才会再次调用。
4. 最终门禁是 `scripts/change-gate.sh <base-sha>`。它不 fetch、不推送、不部署；成功后写入候选 head、base 和运行时指纹。控制器只核验证据，不重复执行门禁。
5. 控制器使用受信任主工作区的预览脚本，将候选 worktree 构建到固定公网预览 `https://zerp-preview.bytesucceed.com`，并核对 exact SHA、浏览器 smoke 和运行时指纹。用户查看预览是可选的，不阻塞自动流程。
6. 到此之前不得调用 GitHub。预览通过后才 fetch 最新 `origin/main`；若 rebase 仅改变 SHA 且运行时指纹不变，复用门禁和预览。指纹改变或发生冲突时，再交给 `$implement` 修复并重新验证，最多三轮。
7. 控制器按本地编号创建远端 Issues、建立原生依赖、推送一个分支，并创建一个引用全部 Issues 的 Ready PR。PR 正文携带 exact head、预览 URL 和运行时指纹。
8. GitHub Actions 对 Ready head 运行适用矩阵。匹配 `automation/local-*` 分支和 exact-head 本地预览标记的 PR，在 CI 成功后直接获得 `full-validation`；普通人工 PR 仍使用原有 `preview-required` 路径。
9. 控制器请求 squash auto-merge，等待真实 merge SHA，再等待生产代理完成部署。`scripts/issue-local-production.sh` 必须同时验证 PR merge SHA、生产 release marker、API、Web 和公网入口。
10. 生产验证成功后，控制器关闭全部远端 Issues、把本地验收项勾选并标为 `done`，最后释放固定预览。

## 失败与恢复

- 实现、审查、门禁、预览或 CI 失败最多进行三轮自动实现/修复；耗尽后整批标为 `blocked`，不会继续发布。
- `needs_input` 立即将整批标为 `needs-input`，不部署预览、不访问 GitHub。
- 进程崩溃后以批次运行目录中的 base、attempt、预览证据、远端 Issue 映射和 PR 编号恢复。远端对象带稳定 marker；重启必须复用，不得重复创建。
- 生产失败会把批次标为 `production-blocked`、写入本地停止开关并在 PR 通知。控制器不得自动执行数据库回滚、清库、恢复或继续下一批。
- 人工处理本地失败后可运行 `scripts/issue-local.sh retry <feature>`；已经发布 PR 的批次不得本地重置。生产故障处理完成后由维护者运行 `scripts/issue-local.sh start`。

## 安装与操作

安装前需要现有的 ChatGPT Codex 登录、`gh` 登录，以及本机可读的 `implement`、`tdd`、`code-review` skills。运行：

```sh
make issue-local-install
scripts/issue-local.sh status
scripts/issue-local.sh stop
scripts/issue-local.sh start
scripts/issue-local.sh retry <feature>
```

安装器只复制控制脚本和 JSON schema，不复制 Codex `auth.json`、GitHub token 或私钥。实现阶段使用 `workspace-write`、`never` approval、`gpt-5.6-sol` high reasoning 和 `ignore-user-config`，并禁用命令网络、Web 和 App 工具；因此不能访问 GitHub、推送、部署或用户凭证。为使独立 linked worktree 能提交，控制器只额外授予该 worktree 的 Git 目录及共享 Git 元数据目录写权限，不授予主工作区文件写权限；启动 Codex 前会以临时索引和临时 ref 验证这两处可写并立即清理。预览和发布动作由控制器分别使用本机现有环境与 `gh` 登录态完成。现有生产代理继续只处理通过 `full-validation` 合入 `main` 的提交。
