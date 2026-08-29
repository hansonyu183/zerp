---
id: ADR-0033
date: 2026-08-27
status: superseded
superseded_by: ADR-0047
---

# 经营主体由 DCL 申报并由 BOB 只读查询

本决策的当前边界由 ADR-0047 取代：经营主体 stable subject、业务编码和强类型版本快照归 DCL，版本头和生命周期归中央 Approval。BOB 不保存当前副本，只以 typed SQL 读取 highest APPROVED DCL snapshot。

`/dcl/operating-entity` 是候选、新建、编辑、启停申请、审批、版本和审计的唯一维护入口；`/bob/operating-entity` 只提供当前有效资料的 `query|get`。两个入口使用独立路由、菜单、权限和 ViewModel，历史事实继续保存 stable ID 与精确 Approval Entry。
