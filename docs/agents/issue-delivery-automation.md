# 本地 Issue 批次自动交付

本流程面向单人、单台受信任 Mac。它不使用远端 Issue 队列、implementer/reviewer GitHub Apps 或定时轮询；多人协作需要另立工作流，不在这里保留兼容分支。

## 完整流程

1. `$to-tickets` 在主工作区生成 `.scratch/<feature>/issues/*.md`。整个目录是一项不可拆分的发布批次。
2. launchd 通过 `WatchPaths` 发现 `ready-for-agent` 批次，控制器领取整批并创建 `automation/local-<feature>` 独立 worktree。
3. 控制器为整批启动临时 `codex exec`，使用 `$implement` 在无网络 workspace sandbox 内完成实现、聚焦测试、双轴 `/code-review` 和提交。
4. 控制器在宿主环境对 clean candidate head 运行 `scripts/change-gate.sh <base-sha>`；Docker、E2E 环境和最终门禁证据只属于宿主控制器。
5. 控制器使用受信任主工作区的预览脚本，将候选 worktree 构建到固定公网预览 `https://zerp-preview.bytesucceed.com`，并核对 exact SHA、浏览器 smoke 和运行时指纹。用户查看预览是可选的，不阻塞自动流程。
6. 到此之前不得调用 GitHub。预览通过后才 fetch 最新 `origin/main`；重放改变运行时指纹或发生冲突时，再交给 `$implement` 修复并重新验证。
7. 控制器按本地编号创建远端 Issues、建立原生依赖、推送一个分支，并创建一个引用全部 Issues 的 Ready PR。PR 正文携带 exact head、预览 URL 和运行时指纹。
8. GitHub Actions 对 Ready head 运行适用矩阵。匹配 `automation/local-*` 分支和 exact-head 本地预览标记的 PR，在 CI 成功后直接获得 `full-validation`；普通人工 PR 仍使用原有 `preview-required` 路径。
9. 控制器请求 squash auto-merge，等待真实 merge SHA，再等待生产代理完成部署。`scripts/issue-local-production.sh` 必须同时验证 PR merge SHA、生产 release marker、API、Web 和公网入口。
10. 生产验证成功后，控制器关闭全部远端 Issues、把本地验收项勾选并标为 `done`，释放固定预览，并删除 clean 候选 worktree 和对应本地分支。清理失败只记录告警，不撤销已经成立的生产证据。

## 失败与恢复

- 需求无法客观判断时整批进入 `needs-input`；代码或验证无法在控制器预算内收敛时进入 `blocked`；宿主预览故障进入 `preview-blocked`。这些状态都不会继续发布。
- 生产失败进入 `production-blocked` 并停止后续批次。数据库恢复和发布车道重开仍由维护者判断，控制器不得自行决定。
- 本地人工恢复使用 `scripts/issue-local.sh stop` 和 `scripts/issue-local.sh retry <feature>`。新候选提交可重开连续失败窗口，同一提交继续快速停止；修复预算、证据复用和崩溃恢复以控制脚本及其回归测试为准。已经发布 PR 的批次不得本地重置。

## 安装与操作

安装前需要现有的 ChatGPT Codex 登录、`gh` 登录，以及本机可读的 `implement`、`tdd`、`code-review` skills。运行：

```sh
ZERP_ISSUE_MESSAGE_RECIPIENT='<本机 iMessage 手机号或地址>' make issue-local-install
scripts/issue-local.sh status
scripts/issue-local.sh stop
scripts/issue-local.sh start
scripts/issue-local.sh retry <feature>
```

首次安装必须以 `ZERP_ISSUE_MESSAGE_RECIPIENT` 传入本机已配置的 iMessage 收件人；安装器只将它保存到 runtime 目录中权限为 `600` 的本机文件，后续重装会自动复用。它不会写入 Git、PR 或普通日志。控制器通过 macOS `Messages`/`osascript` 直接发送，不调用 Codex 或模型；通知仅覆盖 `in-progress`、`pr-open`、`blocked`、`preview-blocked`、`production-blocked`、`needs-input` 和 `done`，不发送 `preview-passed`。同一批次状态的 exact head、PR 和修复计数相同时会去重；发送失败只留下不含收件人或正文的泛化本地日志，且不阻断交付。

安装器只复制控制脚本和 JSON schema，不复制 Codex `auth.json`、GitHub token 或私钥。实现阶段使用无网络 workspace sandbox；GitHub、预览、生产和宿主测试凭证只属于控制器。依赖隔离、凭证挂载、构建缓存、预览恢复和日志协议由对应脚本及回归测试强制执行，不在本文复制实现细节。
