# BOB 仓库当前有效资料用例

## 页面范围

- 路由：`/bob/warehouse`
- 线协议：[OpenAPI](../../../contracts/openapi/openapi.yaml) 与 [BOB Schema](../../../contracts/openapi/schemas/bob.yaml)
- 当前有效资料与业务引用边界：[BOB 领域](../../domains/bob.md)
- 维护、审批、启停申请与停用 blocker 展示：[DCL 仓库申报](../dcl/warehouse.md)

## 当前有效资料读取

1. 页面只调用 `POST /bob/warehouse/query` 和 `POST /bob/warehouse/get`，只显示当前最新正式版本。
2. 列表和详情展示编码、名称、仓库负责人、地址、联系人、Stable ID、来源 Approval Entry ID 与启停状态；不显示候选草稿，也不把候选资料当作当前业务事实。
3. 页面没有新建、编辑、启停、删除、提交、撤回、审核、反批准、驳回、版本或审计动作，也不请求任何 `/bob/warehouse/*` 写路径。
4. 每次查询直接连接 DCL subject、highest APPROVED Approval Entry 与仓库 typed snapshot；DCL 批准或反批准后无需额外写入即可切换、回落或隐藏。仓库 Stable ID、编码和来源 Approval Entry ID 供库存、单据和历史引用追溯。

## 验收场景

1. 只有 BOB `warehouse/query`、`warehouse/get` 权限时可浏览当前有效资料，所有写按钮均不可见。
2. DCL 候选待审、驳回或撤回期间，BOB 继续显示旧正式版本；批准后重新查询才显示新版本。
