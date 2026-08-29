---
id: ADR-0037
date: 2026-08-28
status: superseded
superseded_by: ADR-0047
---

# 产品由 DCL 申报并投影到 BOB 当前业务面

产品沿用 ADR-0033 建立的写入所有权：稳定 subject 与包含基础资料、产品类型、产品分类、计量单位换算、默认包装规格和固定配方的完整强类型版本快照归 DCL，版本头和生命周期归中央 Approval，批准后的当前档案与交易引用解析归 BOB。`/dcl/product` 是新建、候选编辑、启停申请、审批、版本与审计的唯一维护入口；`/bob/product` 只读取当前正式档案。旧 BOB lifecycle、直接启停、产品版本表、写权限与页面动作同时删除，不提供别名、双写或兼容读取。

每次产品批准或反批都在同一 PostgreSQL transaction 原子创建、替换、回落或移除 BOB current source；BOB 通过该 source 读取对应的完整 DCL snapshot，不复制第二份单位换算或固定配方事实。产品类型、分类、计量单位和配方原料均保存选择时的稳定 ID、精确 Approval Entry 与必要名称快照；提交和批准重新校验这些精确来源仍为当前可用版本。库存、订单、生产与会计事实继续保存 stable product ID、实际采用的 Approval Entry、数量和名称等不可变快照，产品后续换版不得重算或改写历史数量、配方、金额和库存事实。
