# 本地 Issue 批次自动交付

本流程面向单人、单台受信任 Mac。它不使用远端 Issue 队列、implementer/reviewer GitHub Apps 或定时轮询；多人协作需要另立工作流，不在这里保留兼容分支。

## 完整流程

1. `$to-tickets` 在主工作区生成 `.scratch/<feature>/issues/*.md`。整个目录是一项不可拆分的发布批次。
2. launchd 通过 `WatchPaths` 发现 `ready-for-agent` 批次，控制器领取整批并创建 `automation/local-<feature>` 独立 worktree。
3. 控制器先记录 Ticket 数量、验收项数量和跨端风险；至少五个 Ticket 或二十项验收条件记为大批次。大批次仍保持一个分支和一个 PR，但 `$implement` 必须按 `Blocked by` 依赖层分段提交并在每层后聚焦验证。最终双轴 `/code-review` 前运行 `scripts/change-gate.sh --fast <base-sha>`，提前关闭格式、生成物、类型和基础测试错误。实现始终运行在无网络 workspace sandbox 内。
4. 控制器在宿主环境对 clean candidate head 运行 `scripts/change-gate.sh <base-sha>`；Docker、E2E 环境和最终门禁证据只属于宿主控制器。集成测试即使有并发组失败也会跑完全部包，并输出结构化的逐包结果。
5. 控制器使用受信任主工作区的预览脚本，将候选 worktree 构建到固定公网预览 `https://zerp-preview.bytesucceed.com`，并核对 exact SHA、浏览器 smoke 和运行时指纹。用户查看预览是可选的，不阻塞自动流程。
6. 到此之前不得调用 GitHub。预览通过后才 fetch 最新 `origin/main`；重放改变运行时指纹或发生冲突时，再交给 `$implement` 修复并重新验证。
7. 控制器按本地编号创建远端 Issues、建立原生依赖、推送一个分支，并创建一个引用全部 Issues 的 Ready PR。PR 正文携带 exact head、预览 URL 和运行时指纹。
8. GitHub Actions 对 Ready head 运行适用矩阵。匹配 `automation/local-*` 分支和 exact-head 本地预览标记的 PR，在 CI 成功后直接获得 `full-validation`；普通人工 PR 仍使用原有 `preview-required` 路径。
9. 控制器请求 squash auto-merge，等待真实 merge SHA，再等待生产代理完成部署。`scripts/issue-local-production.sh` 必须同时验证 PR merge SHA、生产 release marker、API、Web 和公网入口。
10. 生产验证成功后，控制器关闭全部远端 Issues、把本地验收项勾选并标为 `done`，释放固定预览，并删除 clean 候选 worktree 和对应本地分支。清理失败只记录告警，不撤销已经成立的生产证据。

## 失败与恢复

- 每次失败写入结构化 `failure.json`，分类固定为 `product`、`test-flake`、`environment`、`external` 或 `automation`。只有 `product` 会调用 Codex 并消耗代码修复预算；其余类别使用各自的同签名重试预算。
- E2E 或集成测试首次失败时，控制器先在同一 SHA 聚焦复验：复验通过记为 `test-flake` 并直接重跑完整门禁，复验仍失败才记为 `product`。宿主依赖、Docker、网络、预览和 GitHub 查询故障不得伪装成代码修复。
- 需求无法客观判断时整批进入 `needs-input`；产品代码或确定性验证无法在预算内收敛时进入 `blocked`；控制器、宿主环境和外部服务分别进入 `automation-blocked`、`environment-blocked`、`external-blocked`；公网预览和生产失败继续使用 `preview-blocked`、`production-blocked`。这些状态都不会继续发布。
- 生产失败进入 `production-blocked` 并停止后续批次。数据库恢复和发布车道重开仍由维护者判断，控制器不得自行决定。
- 最终门禁记录集成测试的准确失败包。模型提交新修复后，控制器先在宿主环境只复验这些包；通过后仍必须运行完整最终门禁，定向复验不能替代最终证据。Docker、数据库 URL 和本机环境文件都不会交给模型 sandbox。
- 每批产品代码预算是一次初始实现尝试加最多八次修复尝试；Codex 进程或输出协议失败会撤销尚未成立的代码尝试，再使用独立自动化预算。稳定签名由失败分类、阶段和去除 SHA、路径、耗时、尝试编号后的关键错误共同生成；相同产品错误连续出现两次仍会提前阻塞。
- `timeline.jsonl`、`code-attempts/` 和 `attempts/` 分别保留阶段变化、Codex 会话日志及每次结构化失败快照，后一次失败不得覆盖前一次审计。`status` 显示当前阶段、代码尝试、非产品重试和失败分类；`diagnose <feature>` 输出最近十条时间线和准确失败摘要。
- 本地人工恢复使用 `scripts/issue-local.sh stop` 和 `scripts/issue-local.sh retry <feature>`。新候选提交可重开连续失败窗口，同一提交继续快速停止；修复预算、证据复用和崩溃恢复以控制脚本及其回归测试为准。已经发布 PR 的批次不得本地重置。

## 安装与操作

安装前需要现有的 ChatGPT Codex 登录、`gh` 登录，以及本机可读的 `implement`、`tdd`、`code-review` skills。运行：

```sh
ZERP_ISSUE_MESSAGE_RECIPIENT='<本机 iMessage 手机号或地址>' make issue-local-install
scripts/issue-local.sh status
scripts/issue-local.sh diagnose <feature>
scripts/issue-local.sh stop
scripts/issue-local.sh start
scripts/issue-local.sh retry <feature>
```

首次安装必须以 `ZERP_ISSUE_MESSAGE_RECIPIENT` 传入本机已配置的 iMessage 收件人；安装器只将它保存到 runtime 目录中权限为 `600` 的本机文件，后续重装会自动复用。它不会写入 Git、PR 或普通日志。控制器优先通过 macOS `Messages`/`osascript` 直接发送；Messages 无响应或发送失败时，改发不依赖 Messages 的本机系统通知并记录泛化日志，不调用 Codex 或模型。通知仅覆盖 `in-progress`、`pr-open`、`blocked`、`preview-blocked`、`production-blocked`、`needs-input` 和 `done`，不发送 `preview-passed`。控制器每次启动都会补发尚未登记的终态通知，解决旧进程在更新通知逻辑前已经落盘终态的情况。同一批次状态的 exact head、PR 和尝试计数相同时会去重；两种通知都失败时只留下不含收件人或正文的泛化本地日志，且不阻断交付。

安装器只复制控制脚本和 JSON schema，不复制 Codex `auth.json`、GitHub token 或私钥。实现阶段使用无网络 workspace sandbox；GitHub、预览、生产和宿主测试凭证只属于控制器。依赖隔离、凭证挂载、构建缓存、预览恢复和日志协议由对应脚本及回归测试强制执行，不在本文复制实现细节。
