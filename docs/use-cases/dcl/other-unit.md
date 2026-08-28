# 其他单位申报页面用例

## 页面范围

- 路由：`/dcl/other-unit`
- 领域规则：[DCL 领域](../../domains/dcl.md#37-供应商其他单位与销售合作方申报) 与 [BOB 领域](../../domains/bob.md)
- 线协议：[OpenAPI](../../../contracts/openapi/openapi.yaml) 的 `POST /dcl/other-unit/*`

## 页面编排

1. 列表初始不请求；用户显式查询 DCL relationship candidate 与 current 摘要。
2. 新建必须选择经营主体，并二选一选择既有 Party 或创建新 Party。提交请求只有 `partyId` 或 `newParty` 之一、顶层 `operatingEntityId` 和 `data`。
3. 详情显示 Party、经营主体、联系人、电话、邮箱、地址、可选结算方式、备注和 enabled 的完整 typed candidate snapshot；保存不提供 Party 或经营主体变更入口。
4. 根据状态与权限提供 create、save、submit、unsubmit、reject、approve、unapprove、delete、versions 与 audit。启停只通过保存 `enabled` 候选完成。
5. 提交或批准被 Party、经营主体、结算方式来源漂移或正式引用阻断时，保留输入并显示稳定业务错误与 requestId。

## 验收场景

1. 既有 Party 与新 Party 创建均带准确 payload；缺经营主体或同时传两种 Party 入口不能提交。
2. BOB current 在 DCL 批准或反批后原子切换或回落；无 BOB 直接写入口。
3. 深链可打开目标 candidate，状态和权限不允许的动作既不展示也不发起请求。
