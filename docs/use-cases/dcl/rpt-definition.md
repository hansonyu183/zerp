# DCL 报表定义申报页面用例

权威业务规则见 [DCL 报表定义申报](../../domains/dcl.md#39-报表定义申报)、[RPT 报表定义与 DCL](../../domains/rpt.md#3-报表定义与-dcl) 与 [Approval Version](../../domains/approval.md#6-approval-version)，线协议见 [OpenAPI DCL 报表定义 Schema](../../../contracts/openapi/schemas/dcl-rpt-definition.yaml) 与 [OpenAPI RPT Schema](../../../contracts/openapi/schemas/rpt.yaml)。

## 1. 页面与权限边界

1. `/dcl/rpt-definition` 是报表定义唯一维护入口，覆盖新建、编辑、提交、撤回、驳回、批准、反批、草稿删除、启停、版本和审计。
2. 列表调用 `POST /dcl/rpt-definition/query`，区分 latest approved 与唯一 open candidate；详情可以按精确 Approval Entry ID 读取历史版本。
3. 每个动作检查精确 `/dcl/rpt-definition/*` 权限；普通 `/rpt/{code}` 页面只读取目录并执行当前正式定义，不显示维护动作。

## 2. 新建与保存

1. 新建时由系统分配永久冻结的 code；用户录入随版本保存的 name、description、单条只读 SQL、类型化参数和显式结果列契约。
2. 每次保存提交完整 snapshot，不保存差异，不允许从前端拼接任意接口路径。
3. 保存执行结构校验；提交和批准还必须携带校验参数，由后端在只读角色和只读事务中完成完整 SQL、参数及列契约验证。

## 3. 审批、有效性与 RPT 当前执行面

1. DCL 使用中央 Approval 的版本号、状态、revision 和审计事件；`VALID | INVALID` 是独立的 RPT 技术有效性，不改写 Approval 状态。
2. 批准后按上文 DCL 原子性规则使最新 `APPROVED + VALID` 定义的 query/export 权限可用；新版本批准后切换到新 entry。
3. 反批按同一权威规则回落到上一正式版本；没有正式版本时停用使用权限。
4. 最新批准版本为 INVALID 时停止执行，不回退到更低版本；恢复必须通过新候选、重新验证和批准。

## 4. 查询、历史与深链

1. 列表支持编码或名称、审批状态和启停筛选，分页采用全站规则。
2. 版本历史按版本号倒序，审核记录按发生时间倒序，均展示原 Approval Entry ID。
3. APP 工作台的草稿和待审深链固定进入 `/dcl/rpt-definition?code=...&approvalEntryId=...`；不生成 `/rpt/definition` 维护路由。
4. runtime audit 永久保存实际执行定义的 Approval Entry ID；后续换版、反批或失效不重解释历史执行。

## 5. 验收场景

1. 全部维护与生命周期请求只发送到 `/dcl/rpt-definition/*`，旧 `/rpt/definition/*` 路径和权限不可达。
2. 真实 PostgreSQL 覆盖 V1/V2 正式版本切换与反批回落、VALID/INVALID 独立、最新 INVALID 不回退、runtime audit 身份、草稿删除复号及 subscriber 失败整笔回滚。
3. 前端覆盖独立 DCL 菜单和 VM、普通 RPT 只读执行面，以及工作台深链进入 DCL。
