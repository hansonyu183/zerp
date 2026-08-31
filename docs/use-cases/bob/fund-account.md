# BOB 资金账户当前有效资料页面用例

权威业务规则见 [DCL 资金账户申报](../../domains/dcl.md#33-资金账户申报)、[BOB 对象与引用规则](../../domains/bob.md#2-领域职责与边界) 与 [VOU 资金事实](../../domains/vou.md)，线协议见 [OpenAPI BOB Schema](../../../contracts/openapi/schemas/bob.yaml)。

## 1. 页面边界

1. 页面入口为 `/bob/fund-account`，只调用 `POST /bob/fund-account/query` 和 `POST /bob/fund-account/get`，展示当前最新正式资金账户档案。
2. 列表不显示完整账号；详情在具有 `get` 权限后展示编码、名称、币种、经营主体快照、户名、银行、支行、完整账号、备注、Stable ID、来源 Approval Entry ID 与启停状态。
3. 页面没有新建、编辑、启停、删除、提交、撤回、审核、反批准、驳回、版本或审计动作，也不请求任何 `/bob/fund-account/*` 写路径。
4. 每次查询直接连接 DCL subject、highest APPROVED Approval Entry 与资金账户 typed snapshot；DCL 批准或反批准后无需额外写入即可切换、回落或隐藏，业务选择返回 stable ID、当前来源 Approval Entry ID 和必要快照。

## 2. 可见性与异常

1. 只有 BOB `fund-account/query` 权限时可加载列表；打开详情还必须具有 `fund-account/get` 权限。
2. DCL 候选待审、驳回或撤回期间，BOB 继续显示旧正式版本；批准后重新查询才显示新版本，反批准后回落到上一正式版本或消失。
3. 页面不使用当前经营主体名称改写资金账户的已存快照，不在列表、搜索、日志或审计中暴露完整账号。
4. 查询或详情失败时显示业务消息及 `requestId`，并保留当前页面上下文。

## 3. 验收场景

1. 只有 BOB `fund-account/query`、`fund-account/get` 权限时可浏览当前有效资料，所有写按钮均不可见。
2. `/bob/fund-account` 不请求 DCL 写接口；工作台、审批待办和审批记录中的维护深链进入 `/dcl/fund-account`。
3. 交易与会计历史继续遵守 [DCL 资金账户历史事实规则](../../domains/dcl.md#33-资金账户申报)，不因当前有效资料切换而变化。
