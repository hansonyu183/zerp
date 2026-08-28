---
id: ADR-0041
date: 2026-08-28
status: accepted
---

# 供应商申报由 DCL 拥有并投影到 BOB 当前业务面

供应关系 stable root 继续表达 Party 与经营主体的不可变边界；创建、候选版本、启停、审批、历史与审计改由 DCL 唯一拥有。唯一维护路径为 `/dcl/supplier`，`/bob/supplier` 只提供 current `query|get|reference`，不保留 BOB 写入、生命周期、双写或兼容路径。

创建请求固定以既有 `partyId` 或 `newParty` 二选一、顶层 `operatingEntityId` 和供应关系 `data` 组成；新 Party 时同一 PostgreSQL transaction 建立 Party root、DCL Party V1 candidate、供应关系 root 与供应关系 V1 candidate。保存只更新候选完整资料和 `enabled`，不得改变 Party 共享身份或经营主体边界。

`dcl_supplier_versions` 保存短名、税号、联系人、电话、邮箱、地址、备注、结算方式及默认采购员的完整快照；不再保存任何供应商类别。结算方式和默认采购员分别保存 stable ID、精确 Approval Entry 和必要显示资料；默认采购员必须是当前可用 employee 的精确 snapshot。提交和批准重新校验所有已保存来源仍是 latest approved。

批准与反批在同一事务创建、切换、回落或移除 BOB current projection。采购订单、采购入库、采购退货、采购付款及其会计事实继续保存供应关系 stable ID、实际采用的 Approval Entry 与所需快照；正式采购事实精确引用的版本不得反批。候选及后续批准不得改写历史采购或会计事实。
