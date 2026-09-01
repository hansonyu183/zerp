# 其他单位 current 查询页面用例

## 页面范围

- 路由：`/bob/other-unit`
- 领域规则：[BOB 领域](../../domains/bob.md) 与 [DCL 领域](../../domains/dcl.md)
- 线协议：[OpenAPI](../../../contracts/openapi/openapi.yaml) 的 `POST /bob/other-unit/query|get|reference`

本页只读取其他单位的当前有效资料，不拥有 candidate、创建、保存、启停、生命周期、版本或审计能力。

## 列表与详情

1. 用户显式提交编码、名称、状态或适用经营主体筛选；列表固定每页 20 条并按业务编码稳定排序。
2. 打开详情时展示 Other Unit 自有身份、适用及默认经营主体、联系人、可选结算默认快照、备注、enabled 与来源 Approval Entry。
3. 不存在编辑按钮、写 API 调用或 `/bob/other-unit/create` 路径。需维护时，具有 DCL 权限的用户由深链进入 `/dcl/other-unit`；无权用户只看 current。

## 验收场景

1. 列表、详情和 reference 只返回当前有效的只读资料，不泄漏草稿或历史 candidate。
2. BOB 页面不渲染或调用任何写入、生命周期、versions、audit 或 DCL mutation。
3. DCL 深链保留对象上下文；身份和服务资料不能在 BOB 页面改写。
