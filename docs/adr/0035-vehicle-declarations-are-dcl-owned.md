---
id: ADR-0035
date: 2026-08-28
status: superseded
superseded_by: ADR-0047
---

# 车辆由 DCL 申报并投影到 BOB 当前业务面

车辆沿用 ADR-0033 建立的写入所有权：稳定 subject 与完整强类型版本快照归 DCL，版本头和生命周期归中央 Approval，批准后的当前档案与交易引用解析归 BOB。`/dcl/vehicle` 是新建、候选编辑、启停申请、审批、版本与审计的唯一维护入口；`/bob/vehicle` 只读取当前正式档案。旧 BOB lifecycle、直接启停、车辆版本表、权限与页面动作同时删除，不提供别名、双写或兼容读取。

每个车辆快照完整保存车牌、VIN、车型、发动机号、核定载重、散水承运能力、承运归属及来源 Approval Entry。批准和反批在同一 PostgreSQL transaction 原子切换或回落 BOB current；承运归属与 VOU 的精确版本引用会阻止不安全反批。既有运输事实继续保存 stable vehicle ID、实际采用的 Approval Entry ID 和不可变快照，车辆后续改版或承运归属迁移不得重写历史。
