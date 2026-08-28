# 供应商申报页面用例

## 页面范围

- 路由：`/dcl/supplier`
- 领域规则：[DCL 领域](../../domains/dcl.md#37-供应商其他单位与销售合作方申报) 与 [BOB 领域](../../domains/bob.md)
- 采购交易与结算：[VOU 领域](../../domains/vou.md)
- 线协议：[OpenAPI](../../../contracts/openapi/openapi.yaml) 的 `POST /dcl/supplier/*`

## 页面编排

1. 列表初始不请求；用户显式查询 DCL relationship candidate 与 current 摘要。
2. 新建必须选择经营主体，并二选一选择既有 Party 或创建新 Party。保存不允许改变既定 Party 或经营主体边界。
3. 候选维护短名、税号、联系人、电话、邮箱、地址、备注、结算方式、默认采购员与 `enabled`；不展示、传输或恢复供应商类别。草稿可暂缺结算方式或采购员，submit 与 approve 必须具备二者的完整有效 snapshot。
4. 结算方式和默认采购员候选只展示最小投影；保存时采用当前可用来源，详情、版本和采购引用明确展示 stable ID、精确 Approval Entry、编码和名称快照。默认采购员清楚标为我方经办人。
5. 根据状态与权限提供 create、save、submit、unsubmit、reject、approve、unapprove、delete、versions 与 audit。启停只通过保存 `enabled` 候选完成。
6. 采购订单、采购入库、采购退货或采购付款精确引用目标 entry 时，反批显示 blocker；历史采购与 ACC 快照不被页面操作改写。

## 验收场景

1. 既有 Party 与新 Party 创建均带准确 payload；缺经营主体或同时传两种 Party 入口不能提交。
2. Party 或经营主体在创建后不可变；创建失败时页面保留输入并按 DCL 原子创建规则展示错误，不显示孤立的 Party 或供应关系。
3. BOB current 在 DCL 批准或反批后原子切换或回落；无 BOB 直接写入口。
4. 默认采购员或结算方式缺失、失效、非 latest approved、权限不足或 revision 冲突时，页面显示后端结果，不伪造成功并保留可恢复输入。
5. 深链可打开目标 candidate，状态和权限不允许的动作既不展示也不发起请求；含废弃 supplier category 的请求被拒绝。
