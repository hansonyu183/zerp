# 销售合作方变更页面用例

## 页面范围

- 路由：`/dcl/sales-partner`
- 领域规则：[DCL 领域](../../domains/dcl.md#37-供应商其他单位与销售合作方申报) 与 [BOB 领域](../../domains/bob.md)
- 线协议：[OpenAPI](../../../contracts/openapi/openapi.yaml) 的 `POST /dcl/sales-partner/*`

## 页面编排

1. 列表初始不请求；用户显式查询 Sales Partner candidate 与 current 摘要。
2. 新建直接录入自有身份、唯一法定识别号、适用经营主体集合和默认经营主体，不选择 Party。
3. 候选维护完整能力集、联系人、地址、备注与 enabled；草稿能力可为空，submit 与 approve 至少选择一种。
4. 根据状态与权限提供本地 Draft、submit、开放 Submission delete、reject、approve、unreject、unapprove、versions 与 audit。启停只在本地 Draft 编辑并随 submit 冻结。
5. 移除仍被 current 客户归属采用的能力时，submit/approve 显示 blocker；历史订单、收益与会计快照不被页面操作改写。

## 验收场景

1. 法定识别号只在 Sales Partner 类型内唯一；跨档案不比较或合并。
2. BOB 直接读取 highest APPROVED snapshot，在 DCL 批准或反批准后自然切换或回落；无 BOB 直接写入口。
3. 深链可打开目标 candidate，状态和权限不允许的动作既不展示也不发起请求。
4. 空能力草稿可以创建和保存，但 submit 与 approve 都返回稳定校验错误；补充至少一种合法能力后才允许进入或保持正式状态。

## 服务端动作与刷新

列表项和详情根级 `availableApprovalActions` 是生命周期按钮的唯一依据，并与销售合作方业务动作共同组成页面 ViewModel；页面不自行推导动作。任何业务或生命周期动作完成后刷新受影响的 `query` 与已打开对象的 `get`；失败或 revision 冲突不自动重放，仍由执行接口检查并返回 blocker。
