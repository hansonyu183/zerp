---
id: ADR-0033
date: 2026-08-27
status: superseded
superseded_by: ADR-0047
---

# 经营主体由 DCL 申报并投影到 BOB 当前业务面

经营主体的稳定申报主体与强类型版本快照归 DCL，版本头和生命周期归中央 Approval，批准后的当前业务投影与交易引用归 BOB。DCL 与 BOB 分别提供独立页面入口：`/dcl/operating-entity` 是候选读取、新建、编辑、启停申请、审批、版本和审计的唯一维护工作面，`/bob/operating-entity` 只读取当前正式档案并可导航到对应 DCL subject。两个入口使用独立路由、菜单、精确权限和 ViewModel；BOB 页面不调用 DCL 写接口，也不显示生命周期控件。批准、反批、DCL 快照和 BOB 当前投影在同一 PostgreSQL transaction 内完成。

这一拆分让申报事实、审批事实和业务当前事实各有唯一所有者，同时保留稳定 ID、业务编码、Approval entry ID、版本号、精确历史引用和审计事件。系统不保留旧 BOB 写路由、权限、版本表、别名、双写、兼容视图或失败回退；已有数据通过一次性受控 cutover 原位转换。`approval_entries.version_no` 仍是唯一版本号，BOB 当前投影的来源 entry 只作为证据，不成为第二个版本指针。
