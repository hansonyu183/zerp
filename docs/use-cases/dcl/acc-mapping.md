# DCL 会计映射变更页面用例

权威业务规则见 [DCL 会计映射申报](../../domains/dcl.md#38-会计映射申报)、[ACC 当前记账映射](../../domains/acc.md#7-当前记账映射) 与 [Approval Version](../../domains/approval.md#6-approval-version)。目标线 HTTP 由可执行 Hono/Zod 路由提供；#366 前 live Go/OpenAPI 不变且不与 target 组合。

## 1. 页面与权限边界

页面使用目标 Hono `query|get|versions|audit-history|submit-new|submit-change|approve|reject|unreject|unapprove|delete` 路由。

1. `/dcl/acc-mapping` 是会计映射本地 Draft、Submission、版本和审计的唯一维护入口。
2. 列表调用目标 Hono `POST /dcl/acc-mapping/query`，按账簿和 VOU 类型筛选并区分 latest approved 与 open candidate。
3. 每个动作检查精确 `/dcl/acc-mapping/*` 权限，不调用 ACC 写路径。

## 2. 本地 Draft 与提交

1. 新建映射先在 IndexedDB 建立本地 Draft；同一页面可并存多个 Draft，稳定主体为 `(bookId, vouEntity)`。
2. 提交发送完整 snapshot（`defaultResult`、条件规则、凭证模板和可选资产配置）到 `submit-new` 或 `submit-change`，携带 `expectedLatestApprovedSubmissionId` 与 `expectedLatestApprovedRevision`；服务端按历史分配 V1/Vn 并创建 `PENDING`。
3. 字段目录来自 `/acc/mapping/catalog`，固定科目必须是本账簿启用的末级科目。

## 3. 审批与 ACC 当前解释

1. 提交前用统一前端检查定位问题，后端在提交和批准时独立重复完整校验。
2. 批准后原子更新 ACC 当前记账解释和科目登记，反批准后原子回落。
3. 精确 `mappingApprovalEntryId` blocker 和并发控制按领域规则执行。
4. 新批准版本只影响之后发生的会计事实，历史凭证身份和记账结果不变。

## 4. 查询与历史

1. 列表筛选包括账簿、VOU 类型和状态，分页采用全站规则。
2. 版本历史按版本号倒序，审计按发生时间倒序，历史详情只显示当时保存的快照。
3. 失败时保留当前输入和筛选，展示稳定业务消息与 `requestId`。

## 5. ACC 只读页面

1. `/acc/mapping` 是独立的当前映射只读页面，只提供 `query|get|catalog`，不显示写或生命周期动作。
2. 待批准映射深链固定进入 `/dcl/acc-mapping`，两个页面使用独立菜单和权限。

## 6. 验收场景

1. 全部维护与生命周期请求只发送到 `/dcl/acc-mapping/*`，ACC 当前页面没有写或生命周期动作。
2. 真实 PostgreSQL 覆盖完整 snapshot、V1/V2 ACC 当前解释切换与回落、blocker、并发 candidate 和事务回滚。
3. 真实全栈流程覆盖多 VOU 类型、候选换版和独立 ACC 当前只读，待办深链进入 DCL。
4. 映射换版后，既有 VOU 凭证保留原 `approvalEntryId` 和快照，ACC 当前解释只影响新凭证。

## 7. 服务端动作与刷新

列表项和详情根级 `availableApprovalActions` 是生命周期按钮的唯一依据，并与映射业务动作共同组成页面 ViewModel；页面不自行推导动作。任何业务或生命周期动作完成后刷新受影响的 `query` 与已打开对象的 `get`；失败或 revision 冲突不自动重放，仍由执行接口检查并返回 blocker。
