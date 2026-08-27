# DCL 仓库申报页面用例

权威业务规则见 [DCL 仓库申报](../../domains/dcl.md)、[BOB 当前档案职责](../../domains/bob.md) 与 [Approval Version](../../domains/approval.md#6-approval-version)，线协议见 [OpenAPI DCL Schema](../../../contracts/openapi/schemas/dcl.yaml)。

## 1. 页面与列表

1. 页面入口为 `/dcl/warehouse`；它是仓库唯一的维护入口。工作台、审批待办和审批记录中的仓库深链都进入该页面。
2. 列表调用 `POST /dcl/warehouse/query`，展示最新已批准版本和唯一开放候选。新建、保存、启停、提交、撤回、驳回、批准、反批、删除、版本及审计分别检查精确 `/dcl/warehouse/*` 权限。
3. 页面不调用 BOB 写路径；`/bob/warehouse` 仅显示当前正式档案。

## 2. 新建、编辑与启停申请

1. 新建或保存提交完整仓库快照：`name`、`address`、`contactName`、`contactPhone`、`managerEmployeeId` 与 `remark`；编码由服务端生成。页面不展示或发送已废弃的 `category`。
2. 负责人可空，只用于联系与责任展示，不产生仓库操作权限。地址、联系人、联系电话和备注均为可选资料。
3. 编辑已批准仓库、启用或停用都通过 `POST /dcl/warehouse/save` 创建开放候选；其中停用将 `enabled=false` 作为停用申请，不直接改写 BOB 当前档案。
4. 保存或启停申请成功后提示“已生成草稿”，用户按正常流程提交和审核；候选待审期间 BOB 当前档案仍为旧正式版本。

## 3. 审批、停用阻断与历史

1. 首版批准后仓库进入 BOB 当前读取与交易候选；后续版本批准时当前资料原子切换。反批最新正式版本后回落到上一正式版本；反批首版后 BOB 不再有当前档案。
2. 停用确认只发送 DCL `save(enabled=false)` 创建候选草稿，不进行 blocker 检查；当前正式仓库继续可用。批准该停用候选时若服务端返回 `warehouse_disable_blocked`，页面根据 `inventory`、`documents`、`sources`、`references` 展示冲突摘要和 `requestId`，并保留待审核候选与当前档案不变。
3. `versions` 与 `audit-history` 只读展示服务端历史；revision 冲突、自审、非最新版本和引用 blocker 均按稳定 `errorKey` 提示，不按 `message` 分支。

## 4. 验收场景

1. 全部仓库生命周期请求均发送到 `/dcl/warehouse/*`，且 BOB 当前入口没有新建、编辑、启停、提交、审核或删除动作。
2. DCL 停用申请受库存、待处理单据、来源和正式引用阻断；阻断不产生部分状态变化。
3. 稳定仓库 ID、编码、Approval 版本与审计历史在候选批准、反批和 BOB 当前切换中保持可追溯。
