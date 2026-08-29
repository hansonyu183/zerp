# BOB 车辆当前有效资料页面用例

权威业务规则见 [DCL 车辆申报](../../domains/dcl.md#32-车辆申报)、[BOB 车辆承运归属](../../domains/bob.md#24-车辆承运归属) 与 [VOU 销售四单](../../domains/vou.md#32-销售四单)，线协议见 [OpenAPI BOB Schema](../../../contracts/openapi/schemas/bob.yaml)。

## 1. 页面边界

1. 页面入口为 `/bob/vehicle`，只调用 `POST /bob/vehicle/query` 和 `POST /bob/vehicle/get`，展示当前最新正式车辆档案。
2. 列表与详情展示编码、名称、车牌、车型、承运归属、VIN、发动机号、核定载重、散水承运能力、Stable ID、来源 Approval Entry ID 与启停状态；不显示候选草稿，也不把候选资料当作当前运输事实。
3. 页面没有新建、编辑、启停、删除、提交、撤回、审核、反批、驳回、版本或审计动作，也不请求任何 `/bob/vehicle/*` 写路径。
4. 每次查询直接连接 DCL subject、highest APPROVED Approval Entry 与车辆 typed snapshot；DCL 批准或反批后无需额外写入即可切换、回落或隐藏。车辆 Stable ID、编码和来源 Approval Entry ID 供送货、运输和历史引用追溯。

## 2. 可见性与异常

1. 只有 BOB `vehicle/query` 权限时可以加载列表；打开详情还必须具有 `vehicle/get` 权限。
2. DCL 候选待审、驳回或撤回期间，BOB 继续显示旧正式版本；批准后重新查询才显示新版本，反批后回落到上一正式版本或消失。
3. 页面不根据车型、载重、名称或历史送货推断散水能力，不使用当前经营主体或服务关系名称改写车辆快照。
4. 查询或详情失败时显示业务消息及 `requestId`，不回退到 DCL API、旧 BOB lifecycle 或本地假数据。

## 3. 验收场景

1. 只有 BOB `vehicle/query`、`vehicle/get` 权限时可浏览当前有效资料，所有写按钮均不可见。
2. `/bob/vehicle` 不请求 DCL 写接口；工作台、审批待办和审批记录中的维护深链进入 `/dcl/vehicle`。
3. 自有车辆只显示经营主体承运归属，外部车辆只显示“其他单位”服务关系；页面不出现 `platformObjectId` 或临时承运方。
4. 历史送货保留创建时采用的车辆 Approval Entry、承运归属、车牌和散水能力快照，不因当前有效资料切换而变化。
