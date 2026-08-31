# 供应商变更页面用例

## 页面范围

- 路由：`/dcl/supplier`
- 领域规则：[DCL 领域](../../domains/dcl.md#37-供应商其他单位与销售合作方申报) 与 [BOB 领域](../../domains/bob.md)
- 采购交易与结算：[VOU 领域](../../domains/vou.md)
- 线协议：[OpenAPI](../../../contracts/openapi/openapi.yaml) 的 `POST /dcl/supplier/*`

## 页面编排

1. 列表初始不请求；用户显式查询 DCL relationship candidate 与 current 摘要。
2. 新建必须选择经营主体，并二选一选择既有 Party 或创建新 Party。保存不允许改变既定 Party 或经营主体边界。
3. 候选维护短名、税号、联系人、电话、邮箱、地址、备注、结算方式、默认采购员与 `enabled`；不展示、传输或恢复供应商类别。结算方式始终可选；默认采购员的草稿与生效完整性直接采用上述 DCL/BOB 领域规则。
4. 结算方式和默认采购员候选列表保持精简；保存、详情与版本读取遵循上述 DCL/BOB 领域规则。结算方式展示 stable ID、编码、名称与结算参数快照，不展示 AUX Approval Entry；默认采购员展示 stable ID、精确 Approval Entry、编码和名称快照，并清楚标为我方经办人。
5. 根据状态与权限提供 create、save、submit、unsubmit、reject、approve、unapprove、delete、versions 与 audit。启停只通过保存 `enabled` 候选完成。
6. 采购订单、采购入库、采购退货或采购付款精确引用目标 entry 时，反批准显示 blocker；历史采购与 ACC 快照不被页面操作改写。

## 验收场景

1. 既有 Party 与新 Party 创建均带准确 payload；缺经营主体或同时传两种 Party 入口不能提交。
2. Party 或经营主体在创建后不可变；创建失败时页面保留输入并按 DCL 原子创建规则展示错误，不显示孤立的 Party 或供应关系。
3. BOB 直接读取 highest APPROVED snapshot，在 DCL 批准或反批准后自然切换或回落；无 BOB 直接写入口。
4. 默认采购员缺失、失效、非 latest approved 或权限不足，已配置结算方式的自身快照不完整，以及 revision 冲突时，页面显示后端结果，不伪造成功并保留可恢复输入；提交和批准不回查 AUX current。
5. 深链可打开目标 candidate，状态和权限不允许的动作既不展示也不发起请求；含废弃 supplier category 的请求被拒绝。

## 服务端动作与刷新

列表项和详情根级 `availableApprovalActions` 是生命周期按钮的唯一依据，并与供应商业务动作共同组成页面 ViewModel；页面不自行推导动作。任何业务或生命周期动作完成后刷新受影响的 `query` 与已打开对象的 `get`；失败或 revision 冲突不自动重放，仍由执行接口检查并返回 blocker。
