# 销售合作方申报页面用例

## 范围

- 路由：`/dcl/sales-partner`，由 `dcl/sales-partner` 登记。
- typed identity、能力集和适用经营主体规则以 [DCL 供应商、其他单位与销售合作方](../../domains/dcl.md#37-供应商其他单位与销售合作方申报) 为准。

## `DCL-SALES-PARTNER-01` 查询与本地 Draft

1. 页面固定分页查询 sales-partner subject，一行呈现 latest approved 与 open candidate。
2. Draft 编辑身份、联系资料、适用/默认经营主体、能力、备注和启用状态。
3. 能力 wire value 仅为 `EXTERNAL_PART_TIME`、`CHANNEL_PARTNER`，页面使用中文标签且已知值不得显示原码。

## `DCL-SALES-PARTNER-02` 提交与审批

1. Draft 可暂缺能力，submit/approve 由服务端要求至少一种能力并检查引用与身份冲突。
2. 提交失败保留 Draft，成功只删除本次 Draft；审批按钮只来自 `availableApprovalActions`。
3. 撤回只删除开放 Submission，版本历史与 stable subject 保留。

## 验收

1. 页面不恢复 Party、relationship、合并、BOB direct CRUD、服务器 DRAFT 或 `unsubmit`。
2. 正式事实继续保存实际采用的 sales-partner Approval Entry 与必要快照。
