# 其他单位变更页面用例

## 页面范围

- 路由：`/dcl/other-unit`
- 领域规则：[DCL 领域](../../domains/dcl.md#37-供应商其他单位与销售合作方申报) 与 [BOB 领域](../../domains/bob.md)
- 线协议：[OpenAPI](../../../contracts/openapi/openapi.yaml) 的 `POST /dcl/other-unit/*`

## 页面编排

1. 列表初始不请求；用户显式查询 Other Unit candidate 与 current 摘要。
2. 新建直接录入自有身份、强标识、税务、服务资料、适用经营主体集合和默认经营主体，不选择 Party。
3. 详情显示完整身份、适用经营主体、联系人、地址、可选结算方式、备注和 enabled snapshot。
4. 根据状态与权限提供 create、save、submit、unsubmit、reject、approve、unapprove、delete、versions 与 audit。启停只通过保存 `enabled` 候选完成。
5. 提交或批准被经营主体、结算方式来源漂移或正式引用阻断时，保留输入并显示稳定业务错误与 requestId。

## 验收场景

1. 强标识只在 Other Unit 类型内唯一；跨档案不比较或合并。
2. BOB 直接读取 highest APPROVED snapshot，在 DCL 批准或反批准后自然切换或回落；无 BOB 直接写入口。
3. 深链可打开目标 candidate，状态和权限不允许的动作既不展示也不发起请求。
4. 默认经营主体必须属于非空适用集合；创建失败不留下 stable subject 或 candidate 残片。

## 服务端动作与刷新

列表项和详情根级 `availableApprovalActions` 是生命周期按钮的唯一依据，并与其他单位业务动作共同组成页面 ViewModel；页面不自行推导动作。任何业务或生命周期动作完成后刷新受影响的 `query` 与已打开对象的 `get`；失败或 revision 冲突不自动重放，仍由执行接口检查并返回 blocker。
