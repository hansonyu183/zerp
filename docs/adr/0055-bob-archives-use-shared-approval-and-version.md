---
id: ADR-0055
date: 2026-09-07
status: accepted
partially_supersedes: ADR-0046, ADR-0047, ADR-0049, ADR-0051, ADR-0052
---

# BOB 业务档案使用共享 Approval 与 Version

Supplier、Other Unit 与 Sales Partner 从 DCL 迁入 BOB。BOB 是这三类档案的唯一当前写入和读取边界：它持有 stable identity、business code、typed Submission snapshot、对象 `enabled` 和 object revision；它提供正式资料 `query/get`、Submission `submission-query/submission-get`、`versions`、`submit-new/submit-change`、审批动作、开放 Submission `delete` 与 `enable/disable`。旧 DCL 路由、权限、页面、写入和运行时读取一并删除，不保留别名、代理、双写或 fallback。

Approval 继续拥有持久化状态、Submission revision、元数据、职责分离和审计；Version 组件继续拥有版本号、唯一开放 Submission、highest approved 选择与版本并发。两个组件通过普通类型化 Plan 加入 BOB 的同一外层事务，不提前提交、不建立独立 API 域、菜单、服务或万能注册器。WFL 保留自己的当前实现和领域规则，本决定只保证它未来可以独立消费该 Version 接口，不声明 WFL 已迁入 BOB 或已改变其路由。

对象启停是 BOB stable subject 上的即时独立事实：`enabled` 与 object revision 不进入 Submission snapshot，也不随批准、反批准或版本回落改变。启停在同一 BOB 外层事务中重新授权、锁定、CAS、检查实体 blocker 并审计；失败整笔回滚。新对象默认启用，但在拥有已批准版本前不能被新业务引用；停用对象不回落旧版本。新引用采用 highest approved 且 enabled 的档案，历史业务继续用 stable ID、精确 Approval Entry 与已保存快照解释。

一次迁移把旧 snapshot 的 `enabled` 逐条复制到只读 `bob_legacy_enablement_evidence(approval_entry_id, enabled)`，它只保留历史证据，绝不是 current 查询或运行时 fallback。当前对象 enabled 从最高 `APPROVED` 的旧值初始化；仅当没有正式版本、只有开放 V1 时使用该 V1 的旧值。旧 Approval Entry 的 ID、version 与业务内容字段保持不变，只迁 domain；stable subject 改归 `bob_subjects`，权限按精确路径转换。此后所有新 Submission 都不保存 enabled。

精确授权的转换是一对一：`dcl/{entity}/query|get` 转为 `bob/{entity}/submission-query|submission-get`，旧 versions、audit、submit、review 和 delete 路径转为同名 BOB 能力；既有 `bob/{entity}/query|get` 保留为正式资料读取。新增的 `enable/disable` 不从 `submit-change` 或其他旧提交权限推导，除既有 superadmin 通配外，普通角色必须正常授权。转换不扩大权限。

三类档案仍分别保留法定识别号和类型内唯一性。Supplier 保留采购订单、仓库收货、默认采购员、结算方式和适用经营主体规则；Other Unit 保留服务合同、履约验收和外部车辆承运归属规则；Sales Partner 保留 `EXTERNAL_PART_TIME` 与 `CHANNEL_PARTNER` 能力、客户业务归属和反自归属规则。它们不重新引入 Party、关系层、跨档案同步或合并。

本 ADR 部分替代 ADR-0046/0047 中 DCL 独占这三类档案版本写入与 stable subject 的条款，部分替代 ADR-0049 中三类档案由 DCL 承载的条款，部分替代 ADR-0051 的 DCL-only Version consumer 条款，并兑现 ADR-0052 对实际迁移切片的要求。上述 ADR 关于 Hono 契约、临时编辑输入、不可变 Submission、精确授权、历史快照、无兼容层、Customer、Product、AUX 和未迁移 WFL 的条款继续有效。一次迁移保留 stable identity、业务编码、历史 Approval Entry、快照、精确引用和按实际路径转换后的授权；冲突返回 blocker，不自动批准、丢弃或重解释历史。

对应 GitHub [#396](https://github.com/hansonyu183/zerp/issues/396) 与父规格 [#392](https://github.com/hansonyu183/zerp/issues/392)。
