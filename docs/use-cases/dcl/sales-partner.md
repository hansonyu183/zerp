# 销售合作方申报页面用例

## 页面范围

- 路由：`/dcl/sales-partner`
- 领域规则：[DCL 领域](../../domains/dcl.md#37-供应商其他单位与销售合作方申报) 与 [BOB 领域](../../domains/bob.md)
- 线协议：[OpenAPI](../../../contracts/openapi/openapi.yaml) 的 `POST /dcl/sales-partner/*`

## 页面编排

1. 列表初始不请求；用户显式查询 DCL relationship candidate 与 current 摘要。
2. 新建必须选择经营主体，并二选一选择既有 Party 或创建新 Party。保存不允许改变既定 Party 或经营主体边界。
3. 候选维护完整能力集、联系人、电话、邮箱、地址、备注与 enabled；能力显示为“外部兼职销售”和“渠道商”。草稿可为空，submit 与 approve 至少选择一种。
4. 根据状态与权限提供 create、save、submit、unsubmit、reject、approve、unapprove、delete、versions 与 audit。启停只通过保存 `enabled` 候选完成。
5. 移除仍被 current 客户归属采用的能力时，submit/approve 显示 blocker；历史订单、收益与会计快照不被页面操作改写。
6. 同一 Party、经营主体和关系类型已经存在有效关系时，创建返回 `relationship_exists`；页面保留选择并引导维护已有关系。

## 验收场景

1. 既有 Party 与新 Party 创建均带准确 payload；缺经营主体或同时传两种 Party 入口不能提交。
2. BOB 直接读取 highest APPROVED snapshot，在 DCL 批准或反批后自然切换或回落；无 BOB 直接写入口。
3. 深链可打开目标 candidate，状态和权限不允许的动作既不展示也不发起请求。
4. 空能力草稿可以创建和保存，但 submit 与 approve 都返回稳定校验错误；补充至少一种合法能力后才允许进入或保持正式状态。
