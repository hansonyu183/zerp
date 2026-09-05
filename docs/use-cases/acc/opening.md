# 账簿期初页面用例

## 范围

- 路由：`/acc/opening`，由 `acc/opening` 登记。
- Draft、Submission、职责分离、试算与登记事实以 [ACC 账簿期初](../../domains/acc.md#6-账簿期初) 为准。
- 页面只使用 `/acc/book/query`、`/acc/subject/query` 与 `/acc/opening/*` 可执行 Hono 路由。

## `ACC-OPENING-01` 本地 Draft

1. 新建期初只在当前用户当前浏览器保存本地 Draft；新账簿不会自动生成服务器草稿。
2. Draft 使用结构化分录、固定资产、票据和客户空桶编辑器，不用 JSON 文本框或任意字段表单代替业务字段。
3. 保存失败保留内存输入；提交前先写入最新本地内容。

## `ACC-OPENING-02` 提交

1. 零期初允许提交空明细；非零期初逐行提交科目、方向、原币、金额、必填维度及库存数量。
2. 提交成功删除本次本地 Draft，并以服务器 Submission 为最终事实；失败时 Draft 和全部输入必须保留。
3. persisted Submission 不可编辑，不提供服务器 `DRAFT`、`save` 或 `unsubmit`。

## `ACC-OPENING-03` 审批与删除

1. 页面只呈现响应中的 `availableApprovalActions`，不得根据状态、提交人或本地权限推断批准动作。
2. 驳回和反批准要求原因；动作失败后刷新当前 Submission，但不自动重试。
3. 删除开放 Submission 携带当前 revision；批准后或存在 blocker 时以服务端拒绝为准。

## 验收

1. 期初状态只显示 `PENDING | APPROVED | REJECTED`，`versionNo` 不作为页面版本状态。
2. 资产、票据、空桶及业务档案快照均使用专属结构字段。
