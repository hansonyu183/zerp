# 本地 Issue 批次自动交付

本流程面向单人、单台受信任 Mac。它不使用远端 Issue 队列、implementer/reviewer GitHub Apps 或定时轮询；多人协作需要另立工作流，不在这里保留兼容分支。

## 完整流程

1. `$to-tickets` 在主工作区生成 `.scratch/<feature>/issues/*.md`。整个目录是一项不可拆分的发布批次。
2. launchd 通过 `WatchPaths` 发现 `ready-for-agent` 批次，控制器领取整批并创建 `automation/local-<feature>` 独立 worktree。Worktree Environment 通过单一 `ensure(worktree)` 生命周期入口，为候选目录执行准确 pnpm 版本的 `--offline --frozen-lockfile` 安装；每个 worktree 拥有自己的 `node_modules`，只共享 pnpm 内容寻址 store，不读取、链接或复制主工作区安装结果。
3. 控制器先记录 Ticket 数量、验收项数量和跨端风险；至少五个 Ticket 或二十项验收条件记为大批次。大批次仍保持一个分支和一个 PR，但 `$implement` 必须按 `Blocked by` 依赖层分段提交并在每层后聚焦验证。模型返回 clean reviewed commit 后，由宿主控制器强制运行 `scripts/change-gate.sh --fast <base-sha>` 并核对 exact-head 结构化证据，提前关闭格式、生成物、类型和基础测试错误；模型不得在 sandbox 内运行整套门禁。实现始终运行在无网络 workspace sandbox 内。
4. 控制器在宿主环境通过 Validation module 验证 clean candidate：首次运行 `baseline`，独立阶段尽量全部执行并一次收集失败；修复提交只运行 `reverify` 所选的旧失败阶段、被 delta 失效的已通过阶段和必要下游阶段；全部中间证据恢复后运行一次 `release`。Docker、E2E 环境和最终门禁证据只属于宿主控制器。
5. 控制器使用受信任主工作区的预览脚本，将候选 worktree 构建到固定公网预览 `https://zerp-preview.bytesucceed.com`，并核对 exact SHA、浏览器 smoke 和运行时指纹。用户查看预览是可选的，不阻塞自动流程。
6. 到此之前不得调用 GitHub。预览通过后才 fetch 最新 `origin/main`；重放改变运行时指纹或发生冲突时，再交给 `$implement` 修复并重新验证。
7. 控制器按本地编号创建远端 Issues、建立原生依赖、推送一个分支，并创建一个引用全部 Issues 的 Ready PR。PR 正文携带 exact head、预览 URL 和运行时指纹。
8. GitHub Actions 对 Ready head 运行适用矩阵。匹配 `automation/local-*` 分支和 exact-head 本地预览标记的 PR，在 CI 成功后直接获得 `full-validation`；普通人工 PR 仍使用原有 `preview-required` 路径。
9. 控制器请求 squash auto-merge，等待真实 merge SHA，再等待生产代理完成部署。`scripts/issue-local-production.sh` 必须同时验证 PR merge SHA、生产 release marker、API、Web 和公网入口。
10. 生产验证成功后，控制器关闭全部远端 Issues、把本地验收项勾选并标为 `done`，释放固定预览，并删除 clean 候选 worktree 和对应本地分支。清理失败只记录告警，不撤销已经成立的生产证据。

## 失败与恢复

- 每次失败写入结构化 `failure.json`，分类固定为 `product`、`test-flake`、`environment`、`external` 或 `automation`。控制器的 Failure Policy 是分类、历史预算、恢复动作和阻塞状态的唯一决策入口，并把 `RETRY_SAME_HEAD`、`RETRY_ENVIRONMENT`、`RETRY_EXTERNAL`、`REPAIR_CODE` 或对应的 `BLOCK_*` decision 写回失败证据；调用阶段只执行 decision，不再自行组合分类与状态。只有 `product` 会调用 Codex 并消耗代码修复预算；其余类别使用各自的同签名重试预算。
- E2E 或集成测试首次失败时，控制器先在同一 SHA 聚焦复验：复验通过记为 `test-flake` 并重跑当前 Validation 阶段，复验仍失败才记为 `product`。宿主依赖、Docker、网络、预览和 GitHub 查询故障不得伪装成代码修复。
- 需求无法客观判断时整批进入 `needs-input`；产品代码或确定性验证无法在预算内收敛时进入 `blocked`；控制器、宿主环境和外部服务分别进入 `automation-blocked`、`environment-blocked`、`external-blocked`；公网预览和生产失败继续使用 `preview-blocked`、`production-blocked`。这些状态都不会继续发布。
- 生产失败进入 `production-blocked` 并停止后续批次。数据库恢复和发布车道重开仍由维护者判断，控制器不得自行决定。
- Validation module 的 controller interface 固定为 `baseline`、`reverify`、`release`。`baseline` evidence 逐阶段记录 `passed`、`failed` 或 `blocked` 及依赖阻塞原因；`reverify` 从旧 evidence head 到新 candidate head 调用 `change-impact.sh`，保留未受影响的本地 PASS，并复验旧失败、旧阻塞、被 delta 失效以及由 delta 新增的阶段；`release` 才生成可进入预览与发布的最终 exact-head evidence。若 baseline 在未产生修复提交时完整通过且 worktree 仍 clean，它本身就是同一 SHA 的 release evidence，不重复执行；否则必须执行真正的 release。
- Validation 记录集成测试的准确失败包。模型提交新修复后，宿主先复验失败目标，再进入阶段级 `reverify`；中间保留的 PASS 只用于本地收敛，不能替代新 head 的最终 `release`、远端 required checks 或发布证据。Docker、数据库 URL 和本机环境文件都不会交给模型 sandbox。
- Worktree Environment 在实现前、实现后和预览后恢复同一组不变量：候选依赖目录必须由该 worktree 独占，本地临时 store 与构建缓存必须清除，准确 pnpm wrapper 和离线冻结安装必须成功。成功安装会记录 lockfile、根 package、workspace 清单、准确 pnpm 版本和解析后 store 路径的原子指纹；后续 `ensure(worktree)` 只有在指纹与关键 `node_modules` 不变量同时匹配时才走快速返回，清单变化、store 变化或依赖结构损坏都会重新离线安装。候选 lockfile 可以独立演进；主工作区缺少或改变 `node_modules` 不影响候选。升级旧批次时只迁移准确指向主工作区 `node_modules` 的旧 controller-managed symlink，任意其他 symlink 仍按 automation 故障拒绝。依赖清单与 frozen lockfile 不一致属于 product 并交给 Codex 修复；共享 store、缓存或安装环境不可用才属于 environment 并在同一 SHA 重试。两类失败都通过 Failure Policy 决策，preview 不再通过 detach/restore 改写依赖所有权。
- 每批产品代码预算是一次初始实现尝试加最多八次修复尝试；只有 Codex 失败前 HEAD 未变且 worktree clean 才撤销尚未成立的代码尝试。已经产生 clean commit 时保留代码预算和新 HEAD，并在下一次会话只 review 该 delta。`repair-budget.json` 使用 version 2；控制器会原子迁移缺少非产品事件和起始时间的 version 1 旧批次。
- 非产品故障同时受同签名、同阶段、批次总量和批次 wall-clock 四层限制；默认同签名上限按类别为 flake 2、environment 3、external 6、automation 2，同阶段最多 8 次、全批次最多 15 次、截止时间 20 分钟。变化的错误文本不得绕过后面三层上限。稳定签名由失败分类、阶段和去除 SHA、路径、耗时、尝试编号后的关键错误共同生成；相同产品错误连续出现两次仍会提前阻塞。
- GitHub required check 首次失败只进入 same-SHA confirmation。控制器必须验证 PR 与准确 head 的绑定、GitHub Actions provider、失败 check/workflow/conclusion 和不可变 run/job 链接并读取失败 job 证据；恢复后记为外部瞬态，稳定复现后才按产品、测试抖动、环境或自动化分类。
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
