---
id: ADR-0037
date: 2026-08-28
status: superseded
superseded_by: ADR-0047
---

# 产品由 DCL 申报并由 BOB 只读查询

产品 stable subject、业务编码与包含基础资料、产品类型、产品分类、计量单位换算、默认包装规格和固定配方的完整强类型版本快照归 DCL，版本头和生命周期归中央 Approval。`/dcl/product` 是唯一维护入口；`/bob/product` 直接读取 highest APPROVED snapshot，不保存产品副本或提供写动作。

BOB 查询时连接 DCL subject、highest APPROVED Approval Entry 与对应完整 snapshot，不复制第二份单位换算或固定配方事实。产品类型、分类、计量单位和配方原料均保存选择时的稳定 ID、精确 Approval Entry 与必要名称快照；库存、订单、生产与会计事实继续保存实际采用的 Approval Entry 和不可变快照。
