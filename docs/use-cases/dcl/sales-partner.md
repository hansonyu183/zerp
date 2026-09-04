# 销售合作方变更页面用例

## 页面范围

- 路由：`/dcl/sales-partner`
- 领域规则：[DCL 领域](../../domains/dcl.md#37-供应商其他单位与销售合作方申报) 与 [BOB 领域](../../domains/bob.md)
- 目标线 HTTP：可执行 Hono/Zod `POST /dcl/sales-partner/{query|get|versions|audit-history|submit-new|submit-change|approve|reject|unreject|unapprove|delete}`；#366 前 live Go/OpenAPI 不变且不与 target 组合。

## 页面编排

目标线 HTTP 由可执行 Hono/Zod 路由提供；#366 前 live Go/OpenAPI 不变且不与 target 组合。页面使用 `query|get|versions|audit-history|submit-new|submit-change|approve|reject|unreject|unapprove|delete` 路由。

本地 Draft 可在 IndexedDB 并存多个；只有 `submit-new`/`submit-change` 携带 `expectedLatestApprovedSubmissionId` 与 `expectedLatestApprovedRevision` 并由服务端创建 `PENDING` V1/Vn。开放候选与最高 `APPROVED` 当前态同时展示；状态动作仅为 `approve|reject|unreject|unapprove`，开放候选删除使用 `delete`。

1. 列表初始不请求；用户显式调用目标 Hono `query` 查询 Sales Partner candidate 与 current 摘要。
2. 新建直接在 IndexedDB 本地 Draft 录入自有身份、唯一法定识别号、适用经营主体集合和默认经营主体，不选择 Party；同一页面可并存多个 Draft。
3. 候选维护完整能力集、联系人、地址、备注与 enabled；草稿能力可为空，submit 与 approve 至少选择一种。
4. 根据状态与权限提供本地 Draft、`submit-new`/`submit-change`、开放 Submission `delete`、`reject`、`approve`、`unreject`、`unapprove`、`versions` 与 `audit-history`。启停只在本地 Draft 编辑并随 submit 冻结；服务端按 expected latest approved 事实分配 V1/Vn。
5. 移除仍被 current 客户归属采用的能力时，submit/approve 显示 blocker；历史订单、收益与会计快照不被页面操作改写。

## 验收场景

1. 法定识别号只在 Sales Partner 类型内唯一；跨档案不比较或合并。
2. BOB 直接读取 highest APPROVED snapshot，在 DCL 批准或反批准后自然切换或回落；无 BOB 直接写入口。
3. 深链可打开目标 candidate，状态和权限不允许的动作既不展示也不发起请求。
4. 空能力草稿可以创建和保存，但 submit 与 approve 都返回稳定校验错误；补充至少一种合法能力后才允许进入或保持正式状态。

## 服务端动作与刷新

列表项和详情根级 `availableApprovalActions` 是生命周期按钮的唯一依据，并与销售合作方业务动作共同组成页面 ViewModel；页面不自行推导动作。任何业务或生命周期动作完成后刷新受影响的 `query` 与已打开对象的 `get`；失败或 revision 冲突不自动重放，仍由执行接口检查并返回 blocker。
