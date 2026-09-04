# ACC 账簿期初页面用例

## 页面范围

- 路由：`/acc/opening`
- 领域规则：[ACC 账簿期初](../../domains/acc.md#6-账簿期初)与 [Approval Action Availability](../../domains/approval.md#32-approval-action-availability)
- 目标线协议：从可执行 Hono/Zod 路由生成；#366 前 live OpenAPI 保持不变且不与 target 组合
- 全站读取、动作和并发交互：[前端工程约束](../../../frontend/AGENTS.md)

## `ACC-OPENING-01` 选择账簿并读取期初

1. 页面先查询当前用户可见的会计账簿；选择账簿后并行读取该账簿科目和 `POST /acc/opening/query`。
2. 页面只以响应中的 `approval.status` 展示当前正式状态，不建立或读取第二个期初 `state`。
3. 页面只按根级必填 `availableApprovalActions` 展示驳回、批准、恢复审核和反批准；开放 Submission 删除是独立资源动作。不得结合本地权限、提交人或状态补出生命周期动作。
4. 当前账簿或期初刷新失败时保留用户已选账簿，显示错误并允许重新读取，不把旧动作快照继续当作当前事实。

## `ACC-OPENING-02` 编辑本地 Draft 并提交

1. 页面只在本地 Draft 中编辑期初明细、资产、票据和空桶登记；空桶登记遵循 [ACC 账簿期初规则](../../domains/acc.md#6-账簿期初)。本地编辑仍要求可用的账簿和引用读取权限及输入校验。
2. submit 发送完整期初 snapshot；零期初也必须显式 submit，成功后服务器创建 `PENDING` Submission。
3. submit 成功后使用响应覆盖当前期初；失败、blocker 或 revision 冲突保留本地 Draft，并重新读取当前账簿期初，不自动重放。
4. 本地 Draft 的“提交”由 shared model View State 决定；浏览器校验不构成生命周期资格或服务端授权。

## `ACC-OPENING-03` 执行审批动作

1. 页面按 `availableApprovalActions` 的固定顺序展示动作，并显示“驳回、批准、恢复审核、反批准”；“撤回”是开放 Submission 删除。
2. 批准、恢复审核和撤回不请求 reason；驳回和反批准先要求用户填写去除首尾空白后非空的 reason。
3. 动作请求携带当前 `bookId` 与 Approval revision。提交人看不到批准或驳回，但直接调用仍由后端返回 `approval_self_review_forbidden`。
4. 动作成功后用响应刷新期初；动作失败、权限变化、状态变化或 stale revision 时重新查询当前期初且不自动重试。
5. 反批准资格快照不预判后续会计事实；若执行时存在 ACC blocker，页面展示所属领域错误并刷新当前期初。

## 验收场景

- 本地 Draft 的 View State 决定是否展示“提交”；persisted Submission 的动作数组只决定审批按钮；
- 同一待批准期初对提交人不返回审批动作，对不同审核人按精确权限返回“驳回、批准”；开放 Submission 删除仍由目标资源动作重新校验；
- 提交人直接批准或驳回被后端拒绝，审核人可以带原因驳回或批准；
- “驳回”和“反批准”要求原因，“撤回”不显示也不发送原因；
- 所有当前状态、动作、成功提示与现有生命周期审计使用共享 Approval presentation，不出现旧 Approval 别名或 wire value 回退；
- stale revision 和执行期 blocker 都刷新当前期初且不自动重放；
- 真实 PostgreSQL 与隔离全栈验收使用不同提交人与审核人，并同时验证工作台、DCL、VOU 和 ACC Opening 的统一动作与文案。
