---
id: ADR-0038
date: 2026-08-28
status: superseded
superseded_by: ADR-0047
---

# Party 共享身份由 DCL 申报并由 BOB 只读查询

Party stable subject、强类型关系边界、合并记录和完整候选快照由 DCL 拥有，版本头和生命周期归中央 Approval。`/dcl/party` 是身份候选、影响预览、审批、版本和合并维护入口；`/bob/party` 直接读取 highest APPROVED identity snapshot 与按权限裁剪的关系卡片，不保存 Party 副本或提供写路径。

新 Party 不能单独创建。首条客户、供应、雇佣、服务或销售合作关系创建时，在同一个 PostgreSQL transaction 内建立 Party stable subject、DCL Party V1 candidate 与关系；任一步失败全部回滚。V1 在批准前不能由 BOB 读取或用作新的关系候选。强标识按“类型 + 规范化值”在 latest approved 与唯一 open candidate 间共同占用。

批准和反批只改变 Approval 生命周期，BOB 可见结果由查询自然切换、回落或隐藏。历史交易和关系快照不改写。主体合并仍是显式、预检保护的不可逆维护动作，其资料读取和 stale 检查以 DCL subject 与精确 Approval Entry 为准。
