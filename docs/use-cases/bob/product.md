# BOB 产品当前有效资料页面用例

权威业务规则见 [DCL 产品申报](../../domains/dcl.md#34-产品申报)、[BOB 产品业务字段](../../domains/bob.md#21-业务字段) 与 [VOU 产品快照](../../domains/vou.md)，线协议见 [OpenAPI BOB Schema](../../../contracts/openapi/schemas/bob.yaml)。

## 1. 页面边界

1. 页面入口为 `/bob/product`，只调用 `POST /bob/product/query` 和 `POST /bob/product/get`，展示 DCL 最新批准版本形成的当前正式产品档案。
2. 列表展示编码、名称、产品类型、默认录入单位、型号、行为模板和启停状态；详情显示当前来源 Approval Entry 以及基础资料、类型、分类、单位换算、默认包装规格和固定配方的完整 typed snapshot。
3. 页面没有新建、编辑、启停、删除、提交、撤回、审核、反批准、驳回、版本或审计动作，也不请求任何 `/bob/product/*` 写路径。
4. 每次查询直接连接 DCL subject、highest APPROVED Approval Entry 与产品 typed snapshot；DCL 批准或反批准后无需额外写入即可切换、回落或隐藏，业务引用返回 stable product ID、当前来源 Approval Entry、编码、名称、行为模板、单位与所需快照。

## 2. 权限、可见性与异常

1. 只有 BOB `product/query` 权限时可加载列表；打开详情还必须具有 `product/get` 权限。具有 DCL 写权限不自动授予 BOB 读取权限。
2. DCL 候选处于草稿、待审、驳回或撤回状态时，BOB 继续显示旧正式版本；候选批准后重新查询显示新 current，反批准后回落或消失。
3. 页面不根据当前 AUX 名称或当前原料版本改写产品已存 snapshot；查询或详情失败时显示业务消息与 `requestId`，并保留当前页面上下文。
4. `/bob/product` 可导航至同一 stable ID 的 `/dcl/product`，但所有维护动作都在 DCL 页面完成。

## 3. 验收场景

1. BOB 当前入口在桌面与手机均只显示查询、筛选、分页和详情，不显示任何 lifecycle 行操作或编辑表单。
2. DCL V1/V2 批准和反批准后，BOB current source 整体切换或回落，不跨版本拼装基础字段、单位换算或固定配方。
3. 新 VOU 解析 current 并保存精确来源 snapshot；产品后续换版不改变既有库存、订单、生产与 ACC 历史事实。
