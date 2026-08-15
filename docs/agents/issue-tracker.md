# Issue tracker: local ticket batches

开发期间的唯一事实来源是主工作区的 `.scratch/<feature-slug>/issues/*.md`。`$to-tickets` 为一次工作生成一个目录；同目录中的所有 ticket 必须由一次 `$implement` 调用、一个分支、一个公网预览和一个 PR 共同交付。

每个 ticket 使用以下结构：

```md
# <NN> — <title>

**What to build:** <outcome>

**Blocked by:** None — can start immediately. | <earlier ticket numbers>

**Status:** ready-for-agent

- [ ] <objective acceptance criterion>
```

编号按依赖优先排序；`Blocked by` 只能引用本批次中编号更小的 ticket。有效状态是 `ready-for-agent`、`in-progress`、`needs-input`、`blocked` 和 `done`。`.scratch/` 不提交到 Git。

GitHub Issues 不是开发队列。整批本地实现、最终门禁和公网预览通过后，控制器才按编号创建一一对应的远端 Issues，将 `Blocked by` 同时写成 `#<number>` 引用和 GitHub 原生依赖。一个 Ready PR 引用这一批的全部远端 Issues；只有 squash 合并后的生产 SHA、公网 API 和 Web 全部验证成功，控制器才关闭远端 Issues并把本地 ticket 标为 `done`。

人工读取或修改已经发布的远端对象时使用 `gh issue` / `gh pr`。不得把远端 Issue 的后续编辑静默带回正在执行的本地批次；需要改变范围时应停止该批次并重新生成本地 ticket。
