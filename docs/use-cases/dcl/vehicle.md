# DCL 车辆变更页面用例

权威业务规则见 [DCL 车辆申报](../../domains/dcl.md#32-车辆申报)、[BOB 车辆承运归属](../../domains/bob.md#24-车辆承运归属) 与 [Approval Version](../../domains/approval.md#6-approval-version)，线协议见 [OpenAPI DCL Schema](../../../contracts/openapi/schemas/dcl.yaml)。

## 1. 页面与列表

1. 页面入口为 `/dcl/vehicle`；它是车辆唯一的维护入口。工作台、审批待办和审批记录中的车辆深链都进入该页面。
2. 列表调用 `POST /dcl/vehicle/query`，展示最新已批准版本和唯一开放候选。新建、保存、启停、提交、撤回、驳回、批准、反批准、删除、版本及审计分别检查精确 `/dcl/vehicle/*` 权限。
3. 页面不调用 BOB 写路径；`/bob/vehicle/query|get|reference` 仅供内部当前正式资料读取，不存在独立 BOB 页面。

## 2. 新建、编辑与启停申请

1. 新建或保存提交完整车辆快照：名称、车牌、车型、承运归属、VIN、发动机号、核定载重、散水承运能力、备注与 `enabled`；编码由服务端生成。
2. 承运归属使用封闭二选一。选择 `INTERNAL` 时只选择当前可用经营主体；选择 `EXTERNAL` 时只选择当前可用 Other Unit。切换类型清除另一类型输入。
3. 启用或停用都通过 `POST /dcl/vehicle/save` 建立完整候选，不触发 BOB 写入。保存成功后提示“已生成草稿”，候选批准前当前正式车辆继续可用。
4. 散水承运能力使用独立开关并默认关闭；页面不根据车型、核定载重、名称或历史运输推断该值。

## 3. 审批、引用阻断与历史

1. 首版批准后车辆进入 BOB 只读资料并可供送货选择；后续版本批准后 BOB typed query 自然读取新版本。反批准最新正式版本后回落到上一正式版本；反批准首版后 BOB 查询不再返回车辆。
2. 创建与保存按最新可用车型及承运方解析精确 Approval Entry；提交和批准重新校验已保存来源仍是 latest approved。来源改版不自动重写车辆候选或历史版本。
3. 反批准按 DCL 与 VOU 领域规则返回结构化 blocker；失败时保留当前 Approval，页面不自行推断或绕过阻断。
4. `versions` 与 `audit-history` 只读展示服务端历史；revision 冲突、自审、非最新版本、车牌或 VIN 冲突和引用 blocker 均按稳定 `errorKey` 提示，不按 `message` 分支。

## 4. 验收场景

1. 全部车辆页面和生命周期请求均发送到 `/dcl/vehicle/*`；BOB 只保留内部读取接口，没有独立页面、新建、编辑、启停、提交、审核或删除入口。
2. V1/V2 批准和反批准后，BOB typed query 不经额外写入即可显示、切换、回落或隐藏；失败时 DCL snapshot 与 Approval 全部回滚。
3. 自有与外部承运归属、候选并发、来源漂移和 VOU blocker 由真实 PostgreSQL 测试覆盖。
4. 历史 VOU 在车辆后续改版或归属迁移后仍展示原有车辆与承运事实。

## 5. 服务端动作与刷新

列表项和详情根级 `availableApprovalActions` 是生命周期按钮的唯一依据，并与车辆业务动作共同组成页面 ViewModel；页面不自行推导动作。任何业务或生命周期动作完成后刷新受影响的 `query` 与已打开对象的 `get`；失败或 revision 冲突不自动重放，仍由执行接口检查并返回 blocker。
