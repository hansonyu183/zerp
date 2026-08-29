---
id: ADR-0042
date: 2026-08-28
status: superseded
superseded_by: ADR-0047
---

# 客户与客户结算子账户申报由 DCL 拥有并投影到 BOB 当前业务面

客户关系与客户结算子账户是两个独立的 Approval subject。稳定 Party → 客户关系 → 一个或多个结算子账户模型不变：客户关系固定 Party 与经营主体边界，账户固定归属一条客户关系；任一边界在创建后不可改选。

`/dcl/customer` 与 `/dcl/customer-account` 分别唯一拥有创建、候选保存、提交、撤回、驳回、批准、反批、草稿删除、版本和审计。客户创建在同一 PostgreSQL transaction 原子复用或创建 Party、建立客户关系 V1 `DRAFT`，并建立默认客户结算子账户 V1 `DRAFT`；新 Party 的 root 与 Party V1 也属于同一事务。账户创建只传 `customerRelationshipId`，经营主体由关系推导并保存完整精确 snapshot，不接受客户端重复传经营主体。

账户候选保存完整客户业务资料：名称、简称、客户类型、联系人、地址、结算、收款、运输、定价、信用额度、主要业务归属、内部提醒及默认订单备注；来源对象同时保存 stable ID、精确 Approval Entry、编码和名称等所需 snapshot。关系和账户附件分别跟随各自 DCL candidate 复制；只有 `DRAFT` owner version 能改动附件，已批准与历史版本只读，附件类别 snapshot 不回写。

批准或反批在同一事务创建、切换、回落或移除各自 BOB current projection。`/bob/customer` 与 `/bob/customer-account` 只提供 current `query|get|reference`，不得泄露 open candidate 或提供任何 BOB 写入、生命周期和附件写路径。销售、应收、收款、开票及会计历史保存实际使用的账户 stable ID、精确 DCL Approval Entry 和业务 snapshot；历史已批准 entry 即使不再是 current 仍可按精确 entry 校验，正式事实精确引用的 entry 不得反批。

旧客户版本的 `rebateUnitPrice` 与居间计算 `REBATE` 结果不迁入 DCL，也不得映射为 `pricingPolicy.defaultDiscountUnitPrice`。前者属于已被领域规则废止的客户返点模型，后者是客户优惠上限与自动价格输入；本切片随旧 BOB 客户版本表一并删除返点来源、结果字段和分类。
