# Approval 中央审批领域

## 1. 领域职责

Approval 是跨领域的中央审批能力，唯一拥有持久化 Submission 的审批生命周期、操作授权、revision、审批元数据和审计事实。业务 Domain 仍拥有稳定主体、业务数据、业务校验、blocker 和业务效果；Approval 不认识任何 Domain 业务规则。浏览器本地 Draft 不属于 Approval。浏览器与 Hono 运行同一个纯 TypeScript Approval model，浏览器结果只用于交互提示，服务器基于重新读取并锁定的权威事实重新决策。

中央能力同时提供 Approval-only 与 Approval Version 两种条目形态。VOU 和 ACC Opening 使用 Approval-only；实际写入 Approval Version 的业务 Domain 只有 DCL，其实体包括资料申报、ACC Mapping、RPT Definition 与 WFL Definition。BOB 只查询 DCL 当前有效的已批准资料，AUX 使用 Stable-ID Direct CRUD，两者均不注册 Approval subject；ACC、RPT 与 WFL 也不得为这些 DCL 实体另建 Approval subject。

## 2. 审批条目与主体边界

Draft 只保存在已认证用户当前浏览器的 IndexedDB。它可保留未完成输入、显示快照与待提交附件，支持多个草稿、刷新恢复、同设备用户隔离、克隆 Submission 和本地删除；它不产生服务器记录、Approval Entry 或永久业务附件。

`approval_entries` 保存 Submission 的 `id`、`domain`、`entity`、`subject_id`、可空 `version_no`、`status`、`revision` 和统一元数据。Approval-only 条目的 `version_no` 必须为空，同一 `(domain, entity, subject_id)` 最多一条。Approval Version 条目的 `version_no` 必须为正数，`(domain, entity, subject_id, version_no)` 唯一；同一 stable subject 的 `PENDING` 与 `REJECTED` 合计最多一条开放 Submission。

`subject_id` 是指向 Domain stable subject 的受控逻辑外键，不建立中央 `approval_subjects` 或 Domain Store Adapter。Domain application service 必须在同一 PostgreSQL transaction 内创建或删除 stable subject 和审批条目；任一步失败时整体回滚，不得留下 orphan。

`approval_events` 追加保存条目引用快照、动作、前后状态和 revision、操作者、reason、request 与时间。动作只有 `SUBMITTED`、`REJECTED`、`UNREJECTED`、`APPROVED`、`UNAPPROVED` 和 `DELETED`。reason 只保存在 `REJECTED` 与 `UNAPPROVED` 审计事件及当次 typed event 中，不进入条目元数据。

## 3. 生命周期

唯一持久化状态集合为 `PENDING | APPROVED | REJECTED`，转换为：

```text
PENDING --approve--> APPROVED
PENDING --reject--> REJECTED
REJECTED --unreject--> PENDING
APPROVED --unapprove--> PENDING
```

Submission 在 submit 事务中直接创建为 `PENDING`，之后不可编辑。每次 transition 或删除前的并发检查都使用 `revision`，每次 transition 必须令 `revision += 1`。`reject` 和 `unapprove` 必须提供去除首尾空白后仍非空的 reason；`approve` 与 `unreject` 不接受 reason。`PENDING` 的 `approve` 和 `reject` 操作者都必须与当前提交人不同。

状态与元数据始终精确对应：`PENDING` 的提交元数据非空、批准与拒绝元数据为空；`APPROVED` 的提交和批准元数据非空；`REJECTED` 的提交和拒绝元数据非空。`unreject` 仅清空拒绝元数据，`unapprove` 仅清空批准元数据。删除开放 Submission 不伪造状态、也不保留 `WITHDRAWN` 或 `REVOKED` 元数据。

### 3.1 Wire values 与最小共享中文映射

目标 HTTP 状态 wire value 只有 `PENDING`、`APPROVED`、`REJECTED`，共享中文分别为“待批准”“已批准”“已驳回”。公开生命周期 action 只有 `reject`、`approve`、`unreject`、`unapprove`，共享中文分别为“驳回”“批准”“恢复审核”“反批准”。submit 与删除是 Submission 资源动作；界面“撤回”只映射为开放 Submission 删除。审计 action 只有 `SUBMITTED`、`REJECTED`、`UNREJECTED`、`APPROVED`、`UNAPPROVED`、`DELETED`。

中央 Approval 可返回的稳定 `errorKey` 完整集合为：`approval_invalid_actor`、`approval_invalid_configuration`、`approval_invalid_action`、`approval_invalid_revision`、`approval_invalid_request`、`approval_invalid_preparation`、`approval_not_found`、`approval_version_not_found`、`approval_stale_revision`、`approval_invalid_transition`、`approval_self_review_forbidden`、`approval_reason_required`、`approval_reason_not_allowed`、`approval_version_history_exists`、`approval_open_version_exists`、`approval_no_approved_version`、`approval_not_latest_approved`、`approval_versioned_entry`、`approval_not_versioned`、`approval_version_number_conflict`、`approval_conflict`、`approval_event_delivery_failed`。Domain blocker 使用各领域自己的稳定 `errorKey`，不得伪装成 Approval 状态或 message 分支；不保留旧自批错误别名。

### 3.2 Approval Action Availability

Approval Action Availability 是中央 Approval 根据 Submission 当前 `status`、`submittedBy`、当前操作者身份和四项精确生命周期权限生成的查询时快照。Submission 删除是资源动作，仍由目标 Domain 以精确 delete 权限和自己的 blocker 重新校验；它不被伪装成 `unsubmit`。动作资格只使用 Approval 自有事实，不运行库存、期间、引用、最高正式版本或其他 Domain blocker precheck，也不接受调用方传入任意权限路径、支持动作集合、callback、profile 或运行时注册项。

动作按 `reject`、`approve`、`unreject`、`unapprove` 的固定顺序返回，资格闭集如下：

| Approval Status | 当前操作者 | 可按精确权限返回的动作 |
| --------------- | ---------- | ---------------------- |
| `PENDING`       | 提交人本人 | 无                     |
| `PENDING`       | 其他人     | `reject`、`approve`    |
| `REJECTED`      | 提交人本人 | 无                     |
| `REJECTED`      | 其他人     | `unreject`             |
| `APPROVED`      | 任意       | `unapprove`            |

表中每个动作只有在操作者拥有对应 `/{domain}/{entity}/{action}` 精确权限时才返回；`query`、`get`、`save` 或其他宽泛权限不能替代。查询响应中的动作列表不是授权凭证，实际动作接口必须重新检查当前会话、精确权限、状态、revision、职责分离、版本不变量和 Domain blocker。任何快照失效都拒绝当前调用，由客户端刷新事实且不得自动重试。

## 4. 授权与事务边界

Hono 在每次写操作中重新认证会话并检查路由声明的精确 `/{domain}/{entity}/{action}` 权限；调用方不能传入任意 permission path，浏览器计算出的动作资格也不能替代授权。`approve`、`reject` 与 `unreject` 对提交人本人统一返回 `approval_self_review_forbidden`。Trusted System Actor 只能使用系统用户身份显式建立，它可免普通 HTTP role assignment，但不能跳过状态、expected revision、reason、职责分离、Domain validation 或 transaction invariant。

Hono application operation 建立 Kysely transaction，并把同一个 transaction executor 显式传给全部事实读取和持久化步骤；事务内不得回到 pool-level query 或 ambient transaction state。Approval Version 以 `(domain, entity, subject_id)` 的 PostgreSQL transaction-scoped advisory lock 串行化版本历史读写；所有版本历史读取、Submission 创建/删除和状态变更都先取得该锁，再以 `FOR UPDATE` 取得目标条目行锁。

服务器在锁内重读 actor、权限、expected revision、状态、元数据和版本事实，再调用纯 TypeScript Approval model。Versioned subject 的反批准还必须确认目标仍是最高 `APPROVED` 且不存在另一份开放的 `PENDING`/`REJECTED` Submission；已有开放 Submission 时返回稳定错误 `approval_open_version_exists`。Domain model 在相同权威事实上完成自己的业务校验、blocker 和强类型 Plan；application operation 只持久化服务器重新计算出的 Approval 与 Domain Plans，并在提交前复核锁内不变量。

## 5. 强类型事务 Plan

Approval model 返回的强类型 Plan 包含条目动作、前后状态和 revision、操作者、request、reason、提交/批准/拒绝元数据及需要追加的审计事实。Domain model 返回自己的强类型业务效果 Plan；两者不通过 `any`、raw JSON、`map[string]unknown`、callback、反射或通用 effect dispatcher 组合。

application operation 在一个 PostgreSQL transaction 内按明确顺序持久化 Approval Plan 与 Domain Plan。任何一步失败都回滚 Submission、审批状态、审计和全部业务效果；事务内不得产生网络、文件、异步任务等不可回滚副作用。Versioned Plan 明确携带 `versionNo`、`previousApprovedSubmissionId` 与 `currentApprovedSubmissionId`，Domain 不另行推导版本号、正式版本身份或当前指针。

## 6. Approval Version

首次或下一版本由本地 Draft submit 创建 `PENDING` Submission。只有尚无任何版本历史的 stable subject 可以提交 V1；后续版本号从最高 `APPROVED version_no + 1` 分配。没有正式版本或已存在开放 Submission 时拒绝下一版本提交。删除开放 Submission 不消耗编号，因此下一次提交会复用同一号码。系统不保存 `next_version_no`。

`GetLatestApproved` 始终返回 `version_no` 最高的 `APPROVED` 条目；`GetOpenVersion` 返回唯一的 `PENDING` 或 `REJECTED` Submission；`ListVersions` 按版本号倒序返回完整版本头。系统不维护 `current_version_id`、`effective_version_id`、`base_version_id` 或其他当前指针。

开放版本删除只删除 Approval Version 的 `PENDING` 或 `REJECTED` Submission。只允许反批准当前最高的 `APPROVED`：反批准 V2 后 V1 自然成为正式版本；反批准 V1 后允许没有正式版本。若已有另一开放 Submission，服务器在业务写入前返回 `approval_open_version_exists`；PostgreSQL 的开放 Submission 部分唯一约束继续作为最终并发防线，正常流程不依赖 unique violation。

首次与后续版本 submit 使用各 Domain 的精确 `submit-new` 与 `submit-change` 权限，开放 Submission 删除使用 `delete` 权限，读取当前版本使用 `get` 权限，历史列表使用 `versions` 权限；这些路径由可执行 Hono route metadata 固定声明并生成目标权限目录。

## 7. 验收边界

真实 PostgreSQL 验收覆盖 Approval-only 唯一性、V1/V2、开放 Submission 删除后复号、latest approved、只反批准 latest、正式版本回落、版本号与开放 Submission 唯一性、并发 submit，以及正反状态转换、stale revision、permission denied、自批/自驳回/自恢复审核、必需或禁止 reason、元数据精确性、每次 revision 递增、Plan 任一步失败整体回滚和 stable subject-entry 同事务创建/删除不留 orphan。表格测试覆盖每种状态、每项精确权限、提交人/非提交人和动作确定顺序。
