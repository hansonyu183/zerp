---
id: ADR-0040
date: 2026-08-28
status: superseded
superseded_by: ADR-0047
---

# 服务关系与销售合作关系申报由 DCL 拥有

`other-unit` 和 `sales-partner` 的 stable relationship root 继续表达 Party 与经营主体的不可变边界；创建、候选版本、启停、审批、历史和审计改由 DCL 唯一拥有。唯一维护路径为 `/dcl/other-unit` 和 `/dcl/sales-partner`，对应 `/bob/*` 仅提供 current `query|get|reference`。

创建请求统一使用 `partyId` 或 `newParty` 二选一、顶层 `operatingEntityId` 和关系专属 `data`；保存不得改 Party 或经营主体。Other Unit candidate 保存联系人、电话、邮箱、地址、可选结算方式快照、备注和 `enabled`。Sales Partner candidate 保存能力集合、联系人、电话、邮箱、地址、备注和 `enabled`；完整保留 `EXTERNAL_PART_TIME` 与 `CHANNEL_PARTNER` 的既有校验。

批准和反批准在同一事务切换或回落 BOB current projection。VOU、收益和 ACC 历史继续保存 relationship stable ID、来源 Approval Entry 和现有快照；正式事实精确引用的版本不可反批准，后续 candidate 不改写历史。
