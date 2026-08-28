# 客户当前档案用例

## 页面范围

- 路由：`/bob/customer`
- 客户关系、子账户、版本和权限规则：[BOB 领域](../../domains/bob.md) 与 [DCL 领域](../../domains/dcl.md)
- 订单、收款、开票和历史业务边界：[VOU 领域](../../domains/vou.md)
- 线协议：[OpenAPI](../../../contracts/openapi/openapi.yaml) 与 [BOB Schema](../../../contracts/openapi/schemas/bob.yaml)

本页面只读取批准后的客户关系 current projection；候选、附件写入和所有生命周期动作固定进入 `/dcl/customer`，不保留 BOB 写入别名。

## 当前查询与详情

1. 首次进入调用 BOB `query`；列表只展示可交易的 current 关系投影、稳定编码、Party、经营主体、启停状态和当前来源 Approval Entry。
2. 查看调用 BOB `get`，只展示 current 关系资料和到 `/bob/customer-account` 的 current 子账户导航；不得显示 `openVersion`、待审资料、草稿附件或生命周期控件。
3. 页面可以按权限提供“进入申报”深链 `/dcl/customer`，但不在 BOB 内拼装、保存或提交任何 candidate。

## 读取、异常与恢复

1. 列表只使用 current `query` 投影；查看均重新调用 `get`。候选、历史与附件下载均由对应 DCL 页面读取。
2. 读取失败时展示后端业务消息和 `requestId`，保留筛选与页面位置并提供重试，不用列表行或本地默认值拼装详情。
3. BOB 页面没有可保存输入；申报页返回 revision 冲突或来源失效时，显示后端 `errorKey` 并保留 DCL 表单输入。

## 验收场景

1. 列表遵守全站显式筛选、固定分页、稳定排序、窄屏布局和行操作规则；详情总是重新读取。
2. BOB 查询和详情绝不加载或展示 DCL open candidate；有申报权限时仅提供正确 DCL 深链。
3. 当前关系与当前账户的来源 Approval Entry 明确可读，交易引用只使用 current；历史交易跳转由 DCL 精确 entry 校验。
4. BOB 不存在客户创建、保存、审批、附件写入或生命周期控件及网络调用。
