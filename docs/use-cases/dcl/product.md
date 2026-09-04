# DCL 产品变更页面用例

权威业务规则见 [DCL 产品申报](../../domains/dcl.md#34-产品申报)、[BOB 产品业务字段](../../domains/bob.md#21-业务字段)、[AUX 产品与计量对象](../../domains/aux.md) 与 [Approval Version](../../domains/approval.md#6-approval-version)。目标线 HTTP 由可执行 Hono/Zod 路由提供；#366 前 live Go/OpenAPI 不变且不与 target 组合。

## 1. 页面、权限与版本边界

目标线 HTTP 由可执行 Hono/Zod 路由提供；#366 前 live Go/OpenAPI 不变且不与 target 组合。页面使用 `query|get|versions|audit-history|submit-new|submit-change|approve|reject|unreject|unapprove|delete` 路由。

1. 页面入口为 `/dcl/product`，是产品 Draft、Submission、版本和审计的唯一维护入口；工作台、审批待办和审批记录中的产品深链进入本页。
2. 列表调用目标 Hono `POST /dcl/product/query`，每个 stable product 显示一行并区分 latest approved 与 open candidate。查看或历史详情必须调用 `get` 或 `versions`，不得用列表行拼装完整 snapshot。
3. 每个动作检查精确 `/dcl/product/*` 权限。页面不调用 BOB 写路径；`/bob/product/query|get|reference` 仅供内部当前正式资料读取，不存在独立 BOB 页面。

## 2. 本地 Draft 与产品类型切换

1. 新建和编辑均先在 IndexedDB 保存本地 Draft；同一页面可并存多个 Draft，刷新恢复、克隆和删除均不发送业务 HTTP。Draft 可暂缺默认包装规格、单位配置和自制成品固定配方。
2. “提交”发送完整 snapshot（不发送 diff）到目标 Hono `submit-new` 或 `submit-change`，携带 `expectedLatestApprovedSubmissionId` 与 `expectedLatestApprovedRevision`；服务端按历史分配 V1/Vn 并创建 `PENDING`。
3. 产品类型使用“编码 · 名称”的扁平选择项。跨行为模板改选时，页面明确列出并确认将清除的固定配方、默认包装规格或包装物字段；取消保持全部输入，确认后允许候选暂时不完整。
4. 选择 AUX 来源时页面只传 stable ID，服务端按 [DCL 产品申报](../../domains/dcl.md#34-产品申报) 固化来源证据；本地 Draft 可以保留后来失效的来源，submit 和批准必须拒绝来源漂移。

## 3. 单位换算与固定配方

1. 单位换算随产品版本整体维护。每项选择一个当前启用的 AUX 计量单位并填写大于零的定点换算系数；后端把 stable ID、code、name、symbol、`quantityScale` 固化进产品 snapshot，不保存 AUX Approval Entry。换算项重复与默认引用完整性按 [BOB 产品业务字段](../../domains/bob.md#21-业务字段) 检查。
2. 页面只按“录入数量 × 换算系数”显示建议基准数量，用户确认的基准数量才是权威事实。删除默认单位对应换算项时，经确认同步清空选择；取消时保持输入。
3. 自制成品固定配方随同一 snapshot 提交。输出和每行原料同时携带录入数量、包含 `quantityScale` 的单位审计快照与已确认基准数量；原料只允许当前启用且 latest approved 行为为原材料的产品，同一原料不得重复。
4. 从 latest approved 克隆本地 Draft 时，服务端在 submit 阶段按原料 stable ID 更新到其 latest approved entry，同时保持原有基准产量与基准用量。不可用原料保留为待处理，不自动删除；更新后的录入单位与数量必须重新确认后才能提交。

## 4. 提交、批准与当前有效资料

1. 页面在提交前用统一前端检查定位产品类型、默认包装规格、单位配置与固定配方问题；后端在提交和批准时独立重复完整校验。
2. V1 批准后 BOB typed query 直接读取该 snapshot；后续版本批准或反批准后，不经额外写入即可自然切换、回落或隐藏。BOB 不保存 current source，也不复制第二份单位或配方事实。
3. latest approved 与唯一 open candidate 共同占用非空条码。条码冲突、并发候选、revision 冲突、原料来源漂移或正式业务引用 blocker 均返回稳定错误，且 DCL snapshot、Approval 与占用全部保持原状；AUX current 后续变化不使已存 snapshot 漂移。
4. 任一库存、订单、生产或其他正式业务事实精确引用目标 Approval Entry 时禁止反批准。产品后续改版不重算历史数量、配方、金额、库存或 ACC 事实。

## 5. 查询、历史与异常恢复

1. 列表筛选包括关键词、状态、产品类型和产品分类；分页、显式查询触发和编码升序采用全站规则。详情分别展示正在变更与当前交易使用的完整 snapshot，不跨版本合并字段。
2. 版本历史按版本号倒序，审计按发生时间倒序；历史详情只显示当时冻结的类型、分类、单位、默认包装规格和配方快照，不按当前 AUX 或产品重新解释。
3. submit 或动作失败时保留当前本地 Draft、筛选和页面位置，展示稳定业务消息与 `requestId`。

## 6. 验收场景

1. 全部产品页面、维护与生命周期请求只发送到 `/dcl/product/*`；BOB 只保留内部读取接口，没有页面、写、启停或审批入口。
2. 真实 PostgreSQL 覆盖完整 snapshot、V1/V2 highest-approved 读取与回落、AUX/原料精确来源、条码占用、正式引用 blocker、并发 candidate 和事务回滚。
3. 真实全栈流程覆盖三类产品、固定配方、候选换版和独立 BOB 只读资料；待办深链进入 DCL。
4. 产品换版后，既有 VOU、库存、生产与 ACC 仍保留原 stable ID、Approval Entry、数量与名称等不可变快照。

## 7. 服务端动作与刷新

列表项和详情根级 `availableApprovalActions` 是生命周期按钮的唯一依据，并与产品业务动作共同组成页面 ViewModel；页面不自行推导动作。任何业务或生命周期动作完成后刷新受影响的 `query` 与已打开对象的 `get`；失败或 revision 冲突不自动重放，仍由执行接口检查并返回 blocker。
