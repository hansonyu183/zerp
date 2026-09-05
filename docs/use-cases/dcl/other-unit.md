# 其他单位申报页面用例

## 范围

- 路由：`/dcl/other-unit`，由 `dcl/other-unit` 登记。
- typed identity、适用经营主体和结算规则以 [DCL 供应商、其他单位与销售合作方](../../domains/dcl.md#37-供应商其他单位与销售合作方申报) 为准。

## `DCL-OTHER-UNIT-01` 查询与本地 Draft

1. 页面固定分页查询 subject，一行呈现 current 与 candidate。
2. Draft 编辑身份、联系人、地址、适用/默认经营主体、结算方式、备注和启用状态。
3. 引用只从当前 BOB/AUX 候选选择，保存 stable identity 与权威 snapshot。

## `DCL-OTHER-UNIT-02` 提交与生命周期

1. submit/approve 服务端重验引用，失败保留本地 Draft，成功删除本次 Draft。
2. 克隆从最新正式版本建立下一候选；审批动作与删除资格完全采用服务端响应。
3. 版本历史显示不可变 typed snapshot，不回查 current 覆盖旧值。

## 验收

1. 页面不出现 Party、relationship、BOB direct CRUD、服务器 DRAFT 或 `unsubmit`。
2. 不同用户的本地 Draft 隔离，刷新后仍可恢复。
