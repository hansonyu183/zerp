---
id: ADR-0043
date: 2026-08-28
status: accepted
---

# AUX 使用 Stable-ID Direct CRUD 与采用方快照

AUX 是低风险、被其他领域采用的 current 辅助资料，不再使用中央 Approval 或 Approval Version。每个对象由不可变 `id`、不可变系统编码、启停状态、对象 revision 与严格 typed data 组成；创建立即可选，保存立即替换 current data，停用只阻止新选择，未被任何持久化状态引用时才允许物理删除。公开 API 固定为 `create/get/query/save/enable/disable/delete`，不暴露审批、版本或 `approvalEntryId`。

DCL、BOB current、VOU 和其他消费者只用 `(aux entity, stable aux ID)` 解析新选择，并在自身版本或单据中固化会影响业务解释的编码、名称和 typed 参数。AUX 后续改名、调参或停用不重解释已有产品行为、数量精度、金额、结算日期和折旧参数。持久化引用只保存 stable aux ID；任何 entity identity 不一致、孤儿引用或无法由旧 latest approved payload 唯一迁移的情况都使切换失败，不提供兼容读取、双写、旧 entry fallback 或通用引用账本。

中央 Approval 仍只服务明确需要审批或候选版本语义的领域主体；AUX direct CRUD 不削弱 DCL/VOU 自身的 Approval 生命周期，也不允许采用方在运行时回查 AUX current 覆盖既有 snapshot。
