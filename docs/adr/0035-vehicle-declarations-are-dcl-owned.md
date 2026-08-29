---
id: ADR-0035
date: 2026-08-28
status: superseded
superseded_by: ADR-0047
---

# 车辆由 DCL 申报并由 BOB 只读查询

车辆 stable subject、业务编码与完整强类型版本快照归 DCL，版本头和生命周期归中央 Approval。`/dcl/vehicle` 是新建、候选编辑、启停申请、审批、版本与审计的唯一维护入口；`/bob/vehicle` 直接读取 highest APPROVED snapshot，不保存车辆副本或提供写动作。

每个车辆快照完整保存车牌、VIN、车型、发动机号、核定载重、散水承运能力、承运归属及来源 Approval Entry。承运归属与 VOU 的精确版本引用会阻止不安全反批。既有运输事实继续保存 stable vehicle ID、实际采用的 Approval Entry ID 和不可变快照，车辆后续改版或承运归属迁移不得重写历史。
