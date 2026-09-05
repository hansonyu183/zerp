# 供应商申报页面用例

## 范围

- 路由：`/dcl/supplier`，由 `dcl/supplier` 登记。
- 供应商 typed identity、适用经营主体、结算和默认采购员规则以 [DCL 供应商、其他单位与销售合作方](../../domains/dcl.md#37-供应商其他单位与销售合作方申报) 为准。

## `DCL-SUPPLIER-01` 查询与本地 Draft

1. 页面固定分页查询 supplier subject，一行区分 current 与 candidate。
2. Draft 编辑完整身份、适用/默认经营主体、可选结算方式、默认采购员、备注和启用状态。
3. 经营主体与采购员来自 BOB current reference，结算方式来自 AUX；选择保存权威快照，不手输 ID。

## `DCL-SUPPLIER-02` 提交与审批

1. submit/approve 由服务端重验精确引用；供应商不恢复旧 category 或 type 字段。
2. 失败保留 Draft，成功只删除本次 Draft；审批按钮只来自 Submission。
3. 撤回删除开放 Submission，不删除 stable subject 或批准历史。

## 验收

1. 页面不出现 Party、关系、BOB 维护、服务器 DRAFT、`save` 或 `unsubmit`。
2. latest approved 与历史引用 snapshot 不随后续源资料漂移。
