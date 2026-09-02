# ACC 账簿期初页面用例

## 页面范围

- 路由：`/acc/opening`
- 领域规则：[ACC 账簿期初](../../domains/acc.md#6-账簿期初)与 [Approval Action Availability](../../domains/approval.md#32-approval-action-availability)
- 线协议：[OpenAPI ACC Schema](../../../contracts/openapi/schemas/acc.yaml)
- 全站读取、动作和并发交互：[前端工程约束](../../../frontend/AGENTS.md)

## `ACC-OPENING-01` 选择账簿并读取期初

1. 页面先查询当前用户可见的会计账簿；选择账簿后并行读取该账簿科目和 `POST /acc/opening/query`。
2. 页面只以响应中的 `approval.status` 展示当前正式状态，不建立或读取第二个期初 `state`。
3. 页面只按根级必填 `availableApprovalActions` 展示提交、撤回、驳回、批准和反批准；不得结合本地权限、提交人或状态补出生命周期动作。
4. 当前账簿或期初刷新失败时保留用户已选账簿，显示错误并允许重新读取，不把旧动作快照继续当作当前事实。

## `ACC-OPENING-02` 编辑和保存草稿

1. 只有中央 Approval 正式状态为 `DRAFT` 时，页面允许编辑期初明细、资产、票据和空桶登记；空桶登记遵循 [ACC 账簿期初规则](../../domains/acc.md#6-账簿期初)。保存还要求账簿查询与操作权限、业务档案引用查询权限及页面输入校验通过。
2. 保存使用响应中的 Approval revision，并提交完整期初 snapshot。零期初也必须先显式保存，再进入审批流程。
3. 保存成功后使用响应覆盖当前期初；失败或 revision 冲突时重新读取当前账簿期初，不自动重放保存。
4. 草稿存在未保存编辑时仍按服务端返回的动作集合展示“提交”；用户点击后提示先保存当前修改，不提交旧表单内容，也不把本地校验或余额结果改造成生命周期资格。

## `ACC-OPENING-03` 执行审批动作

1. 页面按 `availableApprovalActions` 的固定顺序展示动作，并通过共享 Approval presentation 显示“提交、撤回、驳回、批准、反批准”。
2. 提交、撤回和批准不请求 reason；驳回和反批准先要求用户填写去除首尾空白后非空的 reason。
3. 动作请求携带当前 `bookId` 与 Approval revision。提交人看不到批准或驳回，但直接调用仍由后端返回 `approval_self_review_forbidden`。
4. 动作成功后用响应刷新期初；动作失败、权限变化、状态变化或 stale revision 时重新查询当前期初且不自动重试。
5. 反批准资格快照不预判后续会计事实；若执行时存在 ACC blocker，页面展示所属领域错误并刷新当前期初。

## 验收场景

- 草稿查询返回的动作数组决定是否展示“提交”，本地状态或权限不能补出未返回动作；
- 同一待批准期初对提交人只返回可用的“撤回”，对不同审核人按精确权限返回“撤回、驳回、批准”；
- 提交人直接批准或驳回被后端拒绝，审核人可以带原因驳回或批准；
- “驳回”和“反批准”要求原因，“撤回”不显示也不发送原因；
- 所有当前状态、动作、成功提示与现有生命周期审计使用共享 Approval presentation，不出现旧 Approval 别名或 wire value 回退；
- stale revision 和执行期 blocker 都刷新当前期初且不自动重放；
- 真实 PostgreSQL 与隔离全栈验收使用不同提交人与审核人，并同时验证工作台、DCL、VOU 和 ACC Opening 的统一动作与文案。
