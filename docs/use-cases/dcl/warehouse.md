# 仓库申报页面用例

## 范围

- 路由：`/dcl/warehouse`，由 `dcl/warehouse` 登记。
- 仓库稳定身份、完整版本、审批、负责人引用与停用 blocker 以 [DCL 仓库申报](../../domains/dcl.md#31-仓库申报) 为准。
- 页面只使用 `/dcl/warehouse/*` 可执行 Hono 路由；`/bob/warehouse/*` 不构成维护入口。

## `DCL-WAREHOUSE-01` 查询 Submission

1. 用户按编码、名称、负责人、审批状态和启用状态显式查询固定每页 20 个仓库 subject。
2. 每个 subject 在一行事实中分别呈现 latest approved 与唯一 open candidate；名称、负责人和启用摘要优先反映 candidate，没有 candidate 时反映 current。
3. 任一 current 或 candidate 满足全部筛选条件时该 subject 入选；入选后仍同时呈现两层事实，避免把另一层误当作不存在。
4. 详情读取完整 snapshot；版本与审计按 subject 展示，不从当前列表拼接历史。
5. 迟到的旧查询响应不得覆盖用户更新后的筛选结果。

## `DCL-WAREHOUSE-02` 本地 Draft

1. 新增或从最新正式版本克隆后形成仅属于当前用户、当前浏览器的本地 Draft；页面明确提示其尚未进入服务器。
2. 页面允许同时保存多个 Draft，编辑时按 Draft 串行自动保存；提交前必须刷新最后一次本地保存。
3. 负责人选择与精确版本校验直接遵循领域文档，本用例只规定页面必须使用当前 employee reference 候选。
4. 删除本地 Draft 只删除 IndexedDB 记录，不调用服务器删除接口。

## `DCL-WAREHOUSE-03` 提交与审批

1. 新增调用 `submit-new`，变更调用 `submit-change`；服务端以 expected latest approved facts 和 idempotency key 决定版本。
2. 提交成功只删除本次 Draft 并刷新查询；提交失败保留 Draft 和编辑内容。
3. 页面只呈现 Submission 返回的 `availableApprovalActions`，驳回与反批准要求原因。
4. 删除开放 Submission 调用 `/dcl/warehouse/delete`；revision 冲突后刷新服务器事实，不重放动作。
5. 停用或反批准被库存、单据、来源单或正式引用阻断时，展示服务器 `warehouse_disable_blocked` 或 `warehouse_unapprove_blocked` 事实，Approval 不改变。

## 验收

1. 页面不出现服务器可编辑 DRAFT、`create`、`save`、`unsubmit`、BOB `enable/disable` 或手输 Approval Entry。
2. 刷新页面后本地 Draft 仍存在；不同登录用户看不到彼此 Draft。
3. latest approved、open candidate、revision、审批动作和 blocker 均以服务端响应为准。
