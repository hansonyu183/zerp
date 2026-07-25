# VOU 后端单据域

## 1. 领域边界

VOU（Voucher）负责销售、采购、资金及费用单据的制单、审核、批准、执行、反向流转、附件和审计。首批实体为：

```text
sale-order
purchase-order
intermediary-sale-order
receipt
payment
expense-reimbursement
other-income
```

业务 API 固定为 `POST /vou/{entity}/{action}`，使用 `application/json` 和统一响应包络。文件字节流是技术端点，使用短时令牌访问 `/files/attachments/*`。

VOU 自身不保存库存流水、资金余额、应收应付或往来核销数据。LED 领域同步消费已执行单据并在同一事务中生成库存、资金和往来流水；反执行必须同时生成 LED 反向流水，若会破坏严格库存约束则拒绝。

## 2. 通用契约

### 2.1 编号、金额和引用

单据号由服务端按类型和创建时业务日期生成：

```text
SO/PO/ISO/REC/PAY/ER/OI-YYYYMMDD-######
```

编号创建后不可修改或复用。数量以最多六位小数的十进制字符串传输，金额以两位小数的十进制字符串传输，后端使用定点整数计算。

所有 BOB 引用都传 `objectId` 和 `versionId`。VOU 在写事务内调用 `ResolveEffectiveReference`，并保存编码、名称、单位、币种、车牌等业务快照。之后 BOB 版本失效不改变历史单据。

客户、供应商可在 BOB 中不配置结算方式，但不能据此新建或保存贸易单据。贸易单据保存制单时生效的结算方式对象、版本、编码、名称和规则快照；联系人、电话、地址同样只从客户或供应商有效版本读取并保存快照，不接受客户端直接输入。

新建贸易单据时，客户的 `salespersonEmployeeId` 默认作为销售单或居间销售单的 `salesperson`，供应商的 `salespersonEmployeeId` 默认作为采购单或居间销售单的 `purchaser`。客户端显式传入人员引用时覆盖默认值。已有草稿保存时省略人员字段，保留单据原对象、版本、编码和名称快照，不因主数据或交易对方变化自动替换；显式传入时重新校验并替换。

后端不计算、不保存也不返回 `dueDate`。前端按单据业务日期和结算规则的自然日语义计算：

- `RELATIVE_DAYS`：业务日期加 `dayOffset`，此时 `monthOffset` 必须为 `0` 且无 `dayOfMonth`；
- `MONTH_END`：业务日期偏移 `monthOffset` 月，取该月月末后加 `dayOffset`；
- `FIXED_DAY`：业务日期偏移 `monthOffset` 月后取 `dayOfMonth`，目标月份没有该日时取月末，再加 `dayOffset`。

### 2.2 生命周期

```text
DRAFT ⇄ REVIEWED ⇄ APPROVED ⇄ EXECUTED
```

- `create` 创建草稿；`save` 只允许修改草稿。
- `review`、`approve`、`execute` 逐级前进。
- `unexecute`、`unapprove`、`unreview` 逐级退回，并要求原因。
- `unexecute` 清除当前执行结果，旧值保留在审计事件中。
- 不提供提交、物理删除、作废或更正单。
- 不比较动作操作者身份，只校验精确 APP 路径权限。
- 所有写动作携带文档 `revision`，使用乐观并发控制。

每类实体提供：

```text
query get create save
review unreview approve unapprove execute unexecute
audit-history
attachment-initiate attachment-download attachment-remove
```

## 3. 单据字段

### 3.1 销售单

草稿包含客户、必填业务员、必填仓库、订购日期、币种、备注及至少一条产品明细。新建时省略业务员则从客户默认带入，显式传入可覆盖。明细包含产品、订购数量、含税单价和可选备注（最多 1000 字），行金额和总金额由后端计算。保存时自动快照客户联系人、电话、地址和客户结算方式。

签收完成后一次执行，执行请求包含出库日期、签收日期、物流平台、送货车辆以及每行的出库、签收、拒收和损耗数量。必须满足：

- `订购日期 <= 出库日期 <= 签收日期`；
- `0 < 出库数量 <= 订购数量`；
- `签收 + 拒收 + 损耗 = 出库`；
- 任一行出库少于订购数量时，整单差异原因必填；
- 车辆必须属于所选物流平台。

### 3.2 采购单

草稿包含普通供应商、必填采购员、必填仓库、订购日期、币种、备注及产品明细；新建时省略采购员则从供应商业务员默认带入，显式传入可覆盖。单据自动快照供应商联系人、电话和结算方式。执行请求包含入库日期和逐行入库数量。`订购日期 <= 入库日期`，且 `0 < 入库数量 <= 订购数量`；存在少收时差异原因必填。

### 3.3 居间销售单

草稿同时包含客户、普通供应商、必填业务员和必填采购员，不包含仓库。新建时省略人员字段，分别从客户和供应商默认带入；显式传入可独立覆盖。每条商品行的 `unitPrice` 为客户销售单价，`purchaseUnitPrice` 为必填供应商采购单价；单据抬头总额仍按销售单价计算。其余订购、金额和执行规则与销售单一致。保存时自动快照客户联系人、电话、地址及客户和供应商两套结算方式；供应商表示实际供货厂商，物流平台仍独立选择。

### 3.4 收款单与付款单

草稿包含一个客户或供应商、一个资金账户、必填经办人、业务日期、币种、金额和备注。单据币种必须与资金账户币种一致。首版不关联或核销来源单据；执行只确认单据已实际发生。

### 3.5 费用报销单

草稿包含员工、统一费用日期、统一支出账户、币种、备注及至少一条费用明细。员工即经办人，不增加重复的 `handler`。每条费用包含费用类别文本、说明、金额和可选备注（最多 1000 字）；总金额由后端汇总，币种必须与支出账户一致。

### 3.6 其它收入单

草稿包含来源名称、可选客户或供应商、资金账户、必填经办人、业务日期、币种、金额和备注。币种必须与资金账户一致。

日期仅校验字段先后关系，允许历史补录和未来计划日期。

新增人员、仓库和结算快照列允许整体为空，以兼容迁移前的历史单据。历史单据可正常读取；缺少当前必填属性时，`review`、`approve` 和 `execute` 均拒绝继续正向流转，必须逐级反向回到草稿并通过 `save` 补齐。所有新增人员和仓库仍必须由客户端传 `objectId + versionId`。

## 4. 查询与响应

`query` 支持分页、单号或往来方关键字、状态、业务日期起止和客户/供应商对象 ID。排序字段白名单为 `updatedAt`、`documentNo`、`businessDate`、`status`、`amount`。

`get` 返回抬头、明细、人员、仓库、联系人、结算规则等 BOB 快照、执行结果、审计字段和附件摘要。金额、数量仍以规范化十进制字符串返回；联系人和结算快照是只读字段，响应中不包含 `dueDate`。

## 5. 附件

- 七类单据均支持附件；每单最多 10 个，单文件最多 10 MiB。
- 只允许 PDF、JPEG 和 PNG，并同时校验声明 MIME、文件魔数、大小和 SHA-256。
- 只有草稿可发起或移除附件；审核前不能存在未完成上传。
- 上传令牌一次性且默认 15 分钟；下载令牌一次性且默认 5 分钟。
- 文件保存在配置的本地根目录，使用随机键和原子重命名；用户文件名只能作为下载元数据，不能参与磁盘路径。
- 下载强制 `Content-Disposition: attachment` 和 `X-Content-Type-Options: nosniff`。
- 生产运行限定单 API 实例，并把数据库和附件持久卷作为同一备份恢复边界。

## 6. 事务与审计

创建、保存、状态变化、执行结果、反向动作和附件关联都在文档锁及 revision 校验下完成。编号计数器按实体和业务日期加锁，允许业务上出现号码间隙但禁止重复。

审计事件追加保存事件类型、前后状态、操作者、发生时间、反向原因、请求 ID 和必要的变更摘要。反向动作清理当前态字段，但不得删除历史事件。

单据 `execute` 和 `unexecute` 在完成 VOU 当前态及审计写入后、提交事务前，分别发布 `DocumentExecutedEvent` 和 `DocumentUnexecutedEvent`。主题同时包含生命周期动作和单据实体，库存、账簿等下游领域按指定单据类型订阅。事件携带单据实体、ID、单号、新 revision、操作者和 request ID；反执行事件还携带原因。订阅者通过事件获得的同一个 `pgx.Tx` 查询所需单据快照并写入下游数据。

所有订阅者按启动时的注册顺序同步执行并采用 fail-fast。任一订阅者主动拒绝、返回故障或发生 panic 时，VOU 执行或反执行、审计记录以及此前订阅者的数据库写入全部回滚；没有订阅者时保持现有执行行为。业务拒绝返回冲突响应，其他订阅故障返回内部错误。订阅者不得产生不能由数据库事务回滚的外部副作用。

## 7. 验收

- 七类单据均能完成正向和完整反向链路；
- 销售、采购、居间销售的人员、仓库、联系人和结算规则按制单版本稳定快照；
- 新建贸易单据能从客户或供应商默认带入人员，显式覆盖生效，保存草稿省略人员时保持原快照；
- 缺少结算方式不能创建或保存贸易单据，迁移前缺少新增字段的历史单据不能正向流转；
- 商品和费用明细备注可保存、读取并拒绝超过 1000 字的输入；
- BOB 无效引用、平台车辆不匹配、资金账户币种不匹配被拒绝；
- 数量、金额、日期和差异原因约束同时由服务测试和数据库约束覆盖；
- 并发编号唯一，过期 revision 不产生部分写入；
- 执行与反执行事件按单据类型精确投递，任一订阅失败不产生 VOU 或下游部分写入；
- 居间销售采购单价只允许用于居间商品行，缺失时不能完成正向流转；
- 附件大小、类型、哈希、令牌、路径和权限规则可验证；
- 迁移、sqlc 生成、单元测试、数据库集成测试、vet、build、race、Compose 健康检查全部通过。

## 8. 居间销售 V2 长流程

新建居间销售单显式传 `workflowVersion: 2` 时使用 V2；省略或传 `1` 继续使用本文件前述 V1 四状态流程。两种流程数据隔离，历史单据不迁移，V2 不能调用 `review/unreview/execute/unexecute`。

V2 根单为客户订单，状态为 `DRAFT -> CHECKED -> APPROVED`，完成后自动进入 `COMPLETED`。数量不足时使用 `SHORT_CLOSE_REQUESTED -> SHORT_CLOSED`；申请和确认必须由不同人员完成。采购、收货、送货、签收分别使用：

```text
采购 DRAFT -> CHECKED -> ORDERED
收货 DRAFT -> CHECKED -> CONFIRMED
送货 DRAFT -> CHECKED -> EXECUTED
签收 DRAFT -> CHECKED -> CONFIRMED
```

最终动作不得由本阶段核对人执行。所有反向动作逐级执行并要求 1–1000 字原因；存在下游依赖、短结尚未撤销或反向后数量时间线为负时拒绝。子单草稿可在无附件时物理删除，收货、送货和签收编号不复用；单一采购草稿重建时仍使用 `-P01`。

V2 根单商品行保存销售数量、销售价和产品包装快照。创建时包装默认来自产品有效版本，草稿允许覆盖 `containerType` 和 `quantityPerContainer`，但仍必须满足 BOB 的组合约束。采购子单保存单一普通供应商、采购员、采购日期、采购数量和采购价；收货、送货和签收允许分批。

可送数量为 `确认收货 - 执行送货 + 确认拒收`。送货执行在根单锁内按业务日期重新计算时间线；签收必须满足 `签收 + 拒收 + 损耗 = 送货`，损耗由服务端计算。采购、收货、送货和签收日期不得早于其上游日期。

每张送货单按行计算 `ceil(送货量 / 每桶产品量)`，按 `SOLVENT/RESIN` 汇总应收桶数。签收登记两类实收桶数，少收时原因必填；客户空桶余额增量为应收减实收，正数表示客户欠桶，负数表示多还形成的抵扣余额。

V2 使用下列新增动作，均为独立 APP 权限：

```text
check uncheck approve unapprove
short-close-request short-close-cancel short-close-confirm short-close-unconfirm
procurement-create/get/save/delete/check/uncheck/place/unplace
receipt-create/get/save/delete/check/uncheck/confirm/unconfirm
delivery-create/get/save/delete/check/uncheck/execute/unexecute
signoff-create/get/save/delete/check/uncheck/confirm/unconfirm
{procurement|receipt|delivery|signoff}-attachment-initiate/download/remove
```

子单写请求携带 `documentId`、`rootRevision`、`childId` 和 `childRevision`（创建时省略子单字段）；所有子单写入均递增根 revision。采购详情和价格仅通过采购阶段接口返回，根单查询和详情按 `procurement-get` 权限动态脱敏。
