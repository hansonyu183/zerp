# 供应商当前有效资料用例

## 页面范围

- 路由：`/bob/supplier`
- 当前有效资料与引用：[BOB 领域](../../domains/bob.md)
- 供应商申报与生命周期：[DCL 领域](../../domains/dcl.md#37-供应商其他单位与销售合作方申报)
- 采购交易与结算：[VOU 领域](../../domains/vou.md)
- 线协议：[OpenAPI](../../../contracts/openapi/openapi.yaml) 的 `POST /bob/supplier/query|get` 及 `/bob/reference/query`

本页面只读取供应商 current 正式档案；创建、编辑、启停、审批、历史和审计一律进入 `/dcl/supplier`。页面不显示或调用 BOB 写入及生命周期动作。

## 页面编排

1. 首次进入调用 `query`；关键词、状态、适用经营主体和默认采购员由公共筛选组件明确提交。
2. 详情重新调用 `get`，展示 Supplier 自有身份、适用及默认经营主体、结算方式和默认采购员精确 snapshot。
3. 用户具有 DCL 权限时，只提供进入同一 Supplier stable subject 的深链。
4. 采购单据引用 current Supplier；已保存事实继续使用其精确 Approval Entry 与业务快照。

## 验收场景

1. BOB 页面不存在创建、保存、启停、提交、撤回、驳回、批准、反批准、删除、版本或审计请求。
2. DCL 批准或反批准后，BOB 下一次查询按 highest APPROVED 切换、回落或不再返回该 Supplier；详情不展示开放候选。
3. 后续来源变更不改写已批准 Supplier 或采购历史；Employee 任职经营主体不限制默认采购员选择。
4. Supplier 不包含类别字段。
