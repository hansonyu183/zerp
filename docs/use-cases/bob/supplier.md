# 供应商当前有效资料用例

## 页面范围

- 路由：`/bob/supplier`
- 当前有效资料与引用：[BOB 领域](../../domains/bob.md)
- 供应关系申报与生命周期：[DCL 领域](../../domains/dcl.md#37-供应商其他单位与销售合作方申报)
- 采购交易与结算：[VOU 领域](../../domains/vou.md)
- 线协议：[OpenAPI](../../../contracts/openapi/openapi.yaml) 的 `POST /bob/supplier/query|get` 及 `/bob/reference/query`

本页面只读取供应商 current 正式档案；创建、编辑、启停、审批、历史和审计一律进入 `/dcl/supplier`。页面不显示或调用 BOB 写入及生命周期动作。

## 页面编排

1. 首次进入调用 `query`；关键词、状态、经营主体和默认采购员由公共筛选组件明确提交。列表仅展示当前正式资料、交易可用状态与来源 Approval Entry 摘要。
2. 详情重新调用 `get`，展示 Party 与经营主体的必要资料、供应关系资料、结算方式精确 snapshot 和默认采购员精确 snapshot；供应商类别不显示、不筛选也不传输。
3. 用户具有对应 DCL 权限时，页面只提供进入同一 stable relationship 的 DCL 深链；权限、状态或网络失败时保留筛选和页面位置，并显示后端 `errorKey`、消息和 `requestId`。
4. 采购单据引用候选从 `/bob/reference/query` 读取 current/latest approved 供应关系；已保存采购事实继续使用其精确 Approval Entry 与业务快照，不回查本页 current。

## 验收场景

1. BOB 页面不存在创建、保存、启停、提交、撤回、驳回、批准、反批、删除、版本或审计请求。
2. DCL 批准或反批后，BOB current 原子切换、回落或移除；详情不展示开放候选。
3. 结算方式展示实际采用的 AUX stable ID 与类型化快照，不展示 AUX Approval Entry；默认采购员展示 DCL stable ID、精确 Approval Entry 与名称快照。后续来源变更不改写已批准供应关系或采购历史。
4. 供应关系无 supplier category；任何携带废弃类别字段的 cutover 请求由后端拒绝且不产生部分状态。
