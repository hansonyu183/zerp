# BOB 业务对象领域

## 1. 文档目的

本文定义 ZERP **BOB（Business Object）** 领域的业务模型、状态机、数据约束、事务边界和前后端职责，作为客户、供应商、员工、产品、服务、仓库、车辆、资金账户和结算方式等业务对象的统一实现规范。产品分类、部门、岗位、计量单位、字典和收支类型由 AUX 领域管理。HTTP 路径和数据结构以根目录 OpenAPI 为准。

BOB 使用固定领域标识 `bob`。本文只记录 OpenAPI 无法独立表达的生命周期、引用、并发、审核和交互语义。

当前实体标识为：

```text
customer
supplier
other-party
employee
product
service
warehouse
vehicle
fund-account
settlement-method
```

数据库内部名称可使用 `fund_account`，但 HTTP 路径、权限路径和对外 JSON 中必须始终使用 `fund-account`，不得混用。

## 2. 领域职责与边界

BOB 负责：

- 建立稳定的业务对象身份；
- 保存对象每次新建或编辑产生的独立版本；
- 执行草稿、提交、审核、驳回、生效和失效状态流转；
- 保证只有有效版本能被新的交易业务引用；
- 保存完整版本历史和状态变更审计轨迹；
- 为其他领域提供对象、版本和业务发生时快照所需的数据。

BOB 不负责：

- 销售、采购、库存、资金收付等交易流程；
- 修改已发生业务记录中的历史引用；
- 替交易领域决定需要保存哪些业务快照；
- 物理删除已经进入提交、审核或生效历史的对象、版本和审核记录；
- 绕过 APP 领域执行身份认证和 API 权限判断。

### 2.1 业务字段

八类实体使用类型化版本明细，不使用无约束 JSONB 保存正式业务数据。除由服务端生成且创建后不可修改的 `code` 外，下表字段均随版本保存：

| 实体           | 版本字段                                                                                                                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customer`     | `name`、`customerType`、`shortName`、`taxNumber`、`contactName`、`contactPhone`、`email`、`address`、`remark`、`settlementMethodId`、`monthlyClosingDay`、`salespersonEmployeeId`、`rebateUnitPrice`、`intermediaryOtherPartyId` |
| `supplier`     | `name`、`supplierType`、`shortName`、`taxNumber`、`contactName`、`contactPhone`、`email`、`address`、`remark`、`settlementMethodId`、`salespersonEmployeeId`                                                                     |
| `other-party`  | `name`、`shortName`、`taxNumber`、`contactName`、`contactPhone`、`email`、`address`、`remark`、`settlementMethodId`、`salespersonEmployeeId`                                                                                     |
| `employee`     | `name`、`departmentId`、`positionId`、`phone`、`email`、`hireDate`、`remark`                                                                                                                                                     |
| `product`      | `name`、`productKind`、`inventoryUnitId`、`pricingUnitId`、`pricingQuantityPerInventoryUnit`、`returnable`、`packagingSpecs`、`formula`、`categoryId`、`specification`、`model`、`barcode`、`remark`                             |
| `service`      | `name`、`inventoryUnitId`、`description`、`remark`                                                                                                                                                                               |
| `warehouse`    | `name`、`address`、`contactName`、`contactPhone`、`managerEmployeeId`、`remark`                                                                                                                                                  |
| `vehicle`      | `name`、`plateNumber`、`vehicleType`、`platformObjectId`、`vin`、`engineNumber`、`loadCapacityKg`、`remark`                                                                                                                      |
| `fund-account` | `name`、`currency`、`accountName`、`bankName`、`bankBranch`、`accountNumber`、`remark`                                                                                                                                           |

`customerType` 和 `vehicleType` 保存 AUX 字典项编码；初始客户类型为 `DIT-0001`（终端客户）、
`DIT-0002`（经销商），初始车辆类型为 `DIT-0003`（厢式货车）。`supplierType` 仍是业务枚举，
只能为 `GENERAL` 或 `LOGISTICS_PLATFORM`。

产品类型为原材料、自制成品、定制成品或包装物。普通商品按 kg 定价，并通过换算系数连接库存单位；包装物按自身单位定价，可标记为可回收。商品的多个包装规格引用包装物产品并保存每包装内容量和默认标记。旧桶型迁移成可回收包装物及对应包装规格。

自制成品必须维护版本化固定配方。固定配方由基准产量和一至两百行原料组成，
每行只能引用一个已生效的原材料，原料不可重复且数量必须大于零。配方随产品
版本复制和生效；新销售订单复制配方时按原料对象解析当前有效版本，但保持基准
产量、原料对象和用量不变。原料新版本不影响旧产品版本或已经生成的销售订单
配方快照。原材料、定制成品和包装物不维护产品固定配方。

客户和供应商的 `settlementMethodId` 引用当前启用且生效的 BOB 结算方式，可选维护。交易单据的到期日和销售加价规则见 VOU 文档。

客户的 `monthlyClosingDay` 为月结日，取 `1–31`，默认为 `31`。实际签收日在该日及之前时归入当月账单，在该日之后归入下月账单。`31` 与自然月等价，因此未单独设置时使用 `31`，数据库列保持 `NOT NULL DEFAULT 31`。新建时省略或 UI 空值均归一化为 `31`；保存时省略表示保持原值。

客户的 `rebateUnitPrice` 为返点单价，使用非负、最多两位小数的元/kg 定点字符串，默认 `0.00`。`intermediaryOtherPartyId` 可选引用一个当前有效的 `other-party` 对象。两项都随客户版本保存；销售订单引用客户历史版本，因此后续居间计算以开单时客户版本中的返点价和居间商为准，客户后续修改不追溯改变既有订单。

### 2.2 固定结算方式

BOB 只维护 11 个系统固定对象：`PREPAID` 预付、`CASH_ON_DELIVERY` 现结（货到付款）、`ARRIVAL_3/5/7/15/30` 货到 N 天、`MONTHLY_CURRENT` 当月结、`MONTHLY_30/60/90` 月结 30/60/90 天。名称、`termCode` 和到期规则不可修改，可通过 BOB 的编辑、提交、审批、生效流程修改销售加价，并可启用或停用。禁止新建、删除或增加第 12 种结算方式。

初始销售加价（元/kg）依次为：预付、现结、货到3/5/7/15天均为 `0.00`；货到30天 `0.10`；当月结 `0.05`；月结30/60/90天为 `0.10/0.20/0.30`。加价仅适用于客户销售，供应商采购始终为零。

客户和供应商的 `salespersonEmployeeId` 必填，引用任意当前有效的员工，不附加岗位限制。创建时必须传入；保存时省略表示保持当前员工，显式 `null` 或空字符串无效。存量版本统一回填 `DEMO-EMP-001`，有存量数据但该员工不存在或当前无有效版本时迁移安全失败。

所有新增可选字段在 `save` 中采用补丁语义：省略字段保持当前值，显式传 `null` 或空字符串清空；`monthlyClosingDay` 例外，它不可为空，创建省略时取 `31`，保存省略时保持原值。必填的 `salespersonEmployeeId` 只能省略保持或显式替换为另一有效员工。`name`、`unit`、`currency`、车辆原有字段和 `platformObjectId` 保持既有完整保存契约。调用方不得传入不属于路径实体的字段。

`code` 由服务端按对象实体分配，格式固定为 `PPP-NNNN`：`PPP` 是全局唯一的三位对象前缀，
`NNNN` 是该实体永久递增且不复用的四位流水号。达到 `9999` 后拒绝继续创建。前缀固定为：

```text
customer CUS                 supplier SUP                 other-party OTP
employee EMP                 product PRD
service SVC                  warehouse WHS
vehicle VEH                  fund-account FAC
```

`name` 长度为 1–200；`currency` 为三位大写字母；`plateNumber` 长度为 1–32。

文本长度按 Unicode 字符数计算：简称和联系人上限 100，电话 32，邮箱 254，地址 500，规格、型号及银行字段 200，说明和备注 1000。`hireDate` 使用 `YYYY-MM-DD`。`vin` 可空，非空时为排除 I、O、Q 的 17 位标准大写格式。`loadCapacityKg` 使用大于零、最多三位小数的十进制定点字符串；返回时规范化为三位小数。`accountNumber` 去除空白和连字符并规范化为大写。

客户和供应商税号、产品条码、车辆 VIN、资金账号在各自实体的当前版本之间大小写不敏感唯一；当前草稿和驳回版本仍占用标识，历史非当前版本不占用。车辆车牌沿用相同的当前版本唯一规则。

当前版本使用单级审核，不实现多级审核、委托审核、主动停用、数据范围或归档。对象编码、
对象与版本 ID、审计事件 ID 均由服务端生成；客户端不得传入编码、操作者或审计时间。

### 2.3 首版草稿删除例外

业务对象、版本和审计记录原则上不得物理删除。唯一例外是从未提交、从未审核、从未生效且没有任何外部引用的首版草稿。删除必须同时满足：

- 对象只有版本号为 `1` 的一个版本，且当前状态为 `DRAFT`；
- `current_version_id` 指向请求版本，`effective_version_id` 为空，`next_version_no=2`；
- 对象和版本的 revision 分别与请求中的 `objectRevision`、`revision` 一致；
- `submitted_at`、`submitted_by`、`reviewed_at`、`reviewed_by` 均为空；
- 审计轨迹只包含一条 `CREATED` 以及零条或多条 `SAVED`，没有提交、审核、驳回、生效、失效或编辑历史；
- BOB、VOU 及其他当前已落地领域均不存在指向该对象 ID 或版本 ID 的引用。

删除在单个 PostgreSQL 事务中完成，并固定先锁对象、再锁版本。校验通过后依次删除该聚合的 `CREATED`/`SAVED` 审计事件、类型化版本明细、版本和稳定对象。对象—版本及版本—明细的延迟外键必须在事务提交时整体满足；任一步失败全部回滚。外部引用检查与删除共享同一事务，消费方仍必须通过 `ResolveEffectiveReference` 持有对象共享锁，避免检查后新增引用。

该例外不适用于已提交后又被修正的数据、已产生第二个版本的数据或曾经拥有有效版本的数据。删除是不可恢复操作，不额外写入删除审计事件，因为整个尚未成为正式主数据的聚合会被移除。

### 2.4 物流平台供应商与车辆

物流平台不是独立领域或独立对象，而是 `supplierType=LOGISTICS_PLATFORM` 的供应商。普通供应商使用 `GENERAL`。现有调用方创建供应商时未传 `supplierType`，后端按 `GENERAL` 处理；保存时未传则保持当前类型。物流平台存在当前车辆引用时，不允许改为普通供应商，名称等其他字段仍按统一版本生命周期编辑。

所有车辆都通过 `platformObjectId` 关联一个物流平台供应商。自有、临时和外部车辆分别关联通过供应商 API 创建并审核生效的“自营物流平台”“临时物流平台”或外部物流平台；平台类别不增加独立枚举，由供应商编码和名称表达。车辆不保存平台版本 ID，创建、保存、提交和审核时均重新校验平台当前有效版本及供应商类型。

物流平台撤销批准后，到新版本再次审核生效前没有有效版本。此期间相关车辆自身状态不变，但不能通过 `ResolveEffectiveReference` 被新的业务引用；平台重新生效后自动恢复可引用。

### 2.5 辅助对象与业务对象引用

`categoryId`、`departmentId` 和 `positionId` 分别引用 AUX 的产品分类、部门和岗位；`settlementMethodId`、`managerEmployeeId`、`salespersonEmployeeId` 引用 BOB 的结算方式和员工。创建、保存、提交和审核时，被引用对象必须存在、处于可引用状态且实体类型匹配。

产品分类只允许用于产品，不再为客户、供应商、员工、服务、仓库、车辆、资金账户等对象提供含义宽泛的通用分类。AUX 对象停用或修改后不会追溯改变已经生效的 BOB 版本；新的草稿和审核操作必须按当时状态重新校验。车辆与物流平台的严格递归有效性规则仍按 2.3 节执行。

## 3. 聚合模型

### 3.1 业务对象聚合

一个 BOB 聚合由稳定对象、多个对象版本和追加式审计事件组成：

```text
BusinessObject (稳定身份)
  ├── Version 1
  ├── Version 2
  ├── ...
  └── AuditEvent 1..n
```

建议共享生命周期表，并为各实体建立类型化版本明细表：

| 模型             | 建议表名                    | 用途                                     |
| ---------------- | --------------------------- | ---------------------------------------- |
| 业务对象         | `bob_objects`               | 保存稳定身份、实体类型和当前指针         |
| 对象版本         | `bob_versions`              | 保存版本号、状态和审核审计字段           |
| 状态事件         | `bob_audit_events`          | 追加保存每次状态变化和意见               |
| 客户版本明细     | `bob_customer_versions`     | 客户类型化业务字段，与版本一对一         |
| 供应商版本明细   | `bob_supplier_versions`     | 供应商类型化业务字段，与版本一对一       |
| 员工版本明细     | `bob_employee_versions`     | 员工类型化业务字段，与版本一对一         |
| 产品版本明细     | `bob_product_versions`      | 产品类型化业务字段，与版本一对一         |
| 服务版本明细     | `bob_service_versions`      | 服务类型化业务字段，与版本一对一         |
| 仓库版本明细     | `bob_warehouse_versions`    | 仓库类型化业务字段，与版本一对一         |
| 车辆版本明细     | `bob_vehicle_versions`      | 车辆字段及物流平台对象引用，与版本一对一 |
| 资金账户版本明细 | `bob_fund_account_versions` | 资金账户类型化业务字段，与版本一对一     |

业务字段尚未确定前，不应仅为追求通用性把全部正式字段长期存入无约束 JSONB。类型化明细表可以提供外键、唯一性、精度、长度和查询索引约束；共享表只承载所有实体一致的生命周期信息。

### 3.2 业务对象

`bob_objects` 至少包含：

| 字段                       | 约束             | 说明                                 |
| -------------------------- | ---------------- | ------------------------------------ |
| `id`                       | 主键             | 对象稳定标识，跨版本不变             |
| `entity`                   | 非空             | 对外实体标识                         |
| `current_version_id`       | 外键、非空       | 最新创建的版本                       |
| `effective_version_id`     | 外键、可空       | 当前可供新业务引用的版本             |
| `oit_id`                   | 可空、按实体唯一 | 旧 OIT 聚合根映射，仅数据库内部使用  |
| `next_version_no`          | 非空             | 下一个版本号，或使用等效安全分配机制 |
| `revision`                 | 非空             | 对象级乐观并发版本                   |
| `created_at`、`created_by` | 非空             | 创建审计信息                         |
| `updated_at`、`updated_by` | 非空             | 最后修改审计信息                     |

`current_version_id` 和 `effective_version_id` 指向的版本必须属于同一 `object_id` 且实体类型一致。该跨行规则应由事务内校验配合数据库约束实现，不能只依赖客户端。由于对象与首个版本相互引用，创建时应预生成两个 ID，并把相关外键定义为可延迟到事务提交时检查，或采用经过评审的等效无循环结构；不得为绕开插入顺序而在事务提交后留下空的 `current_version_id`。

`oit_id` 只用于旧 OIT 聚合根映射：非空值不得含首尾空格，长度为 1–64，并在同一 `entity` 内唯一。应用 HTTP/API/UI 不读取或写入该字段。

### 3.3 对象版本

`bob_versions` 至少包含：

| 字段                           | 约束       | 说明               |
| ------------------------------ | ---------- | ------------------ |
| `id`                           | 主键       | 版本标识           |
| `object_id`                    | 外键、非空 | 所属稳定对象       |
| `version_no`                   | 非空       | 对象内从 1 递增    |
| `status`                       | 非空       | 生命周期状态       |
| `revision`                     | 非空       | 版本级乐观并发版本 |
| `created_at`、`created_by`     | 非空       | 版本创建信息       |
| `submitted_at`、`submitted_by` | 可空       | 最近一次提交信息   |
| `reviewed_at`、`reviewed_by`   | 可空       | 最近一次审核信息   |
| `review_comment`               | 可空       | 最近一次审核意见   |

数据库约束至少包括：

- `(object_id, version_no)` 唯一；
- 每个版本恰好存在一条与实体类型匹配的版本明细；
- 每个对象最多一个 `EFFECTIVE` 版本；
- 每个对象最多一个处于 `DRAFT` 或 `PENDING` 的候选版本；
- `PENDING` 必须具有提交人和提交时间；
- `EFFECTIVE`、`INVALID` 必须具有审核人和审核时间；
- 提交人与审核人不得相同；唯一例外是系统用户执行的自动种子数据流程，其提交和审核均归属系统用户。

可用 PostgreSQL 部分唯一索引保证“最多一个有效版本”和“最多一个候选版本”。无法用简单约束表达的跨表规则必须集中在领域服务和数据库集成测试中验证。

### 3.4 审计事件

`bob_audit_events` 是追加式记录，至少包含：

- `id`、`object_id`、`version_id`；
- `entity`、`event_type`；
- `from_status`、`to_status`；
- `actor_id`、`occurred_at`；
- `comment`；
- `request_id`；
- 必要且经过脱敏的变更摘要。

事件类型至少包括 `CREATED`、`SAVED`、`SUBMITTED`、`UNSUBMITTED`、`APPROVED`、`UNAPPROVED`、`REJECTED`、`ENABLED`、`DISABLED`、`INVALIDATED`。业务事务回滚时，对应审计事件也必须回滚，禁止记录未发生的状态变化。

## 4. 生命周期状态机

### 4.1 状态定义

| 状态        | 可修改业务字段 | 可提交 | 可审核 |   可被新业务引用 |
| ----------- | -------------: | -----: | -----: | ---------------: |
| `DRAFT`     |             是 |     是 |     否 |               否 |
| `PENDING`   |             否 |     否 |     是 |               否 |
| `EFFECTIVE` |             否 |     否 |     否 |               是 |
| `INVALID`   |             否 |     否 |     否 | 否（仅历史版本） |

允许的状态转换只有：

```text
create:  (none)    → DRAFT
delete: DRAFT(v1)  → (none)，仅适用 2.2 节的唯一例外
submit: DRAFT      → PENDING
unsubmit: PENDING  → DRAFT
approve: PENDING   → EFFECTIVE
reject:  PENDING   → DRAFT
unapprove: EFFECTIVE → INVALID（冻结旧版本），并创建新的 PENDING
```

除上述转换外全部拒绝。尤其禁止：

- 直接创建 `EFFECTIVE` 版本；
- 修改 `PENDING`、`EFFECTIVE` 或 `INVALID` 的业务字段；
- 通过普通保存接口修改状态或审计字段。

### 4.2 草稿编辑与历史版本冻结

只有 `DRAFT` 当前版本可以保存业务字段。有效对象需要修改时，必须先执行 `unapprove`，并在同一事务内：

1. 锁定 `bob_objects` 当前行；
2. 校验对象 `revision` 和当前有效版本；
3. 将原 `EFFECTIVE` 版本更新为 `INVALID`，此后永久只读；
4. 清空 `effective_version_id`；
5. 复制业务明细，创建版本号递增的新 `PENDING` 版本；
6. 更新 `current_version_id` 和对象 `revision`；
7. 写入原版本冻结和撤销批准审计事件。

任一步失败必须全部回滚。新版本继续执行 `unsubmit` 后进入 `DRAFT` 才能编辑。事务提交后到新版本再次审核通过前，该对象没有可供新业务引用的有效版本。

### 4.3 驳回与撤回

驳回和撤回提交都把当前 `PENDING` 版本退回 `DRAFT`，清空版本行上的最近提交、审核字段；驳回意见、反向原因和全部历史过程保留在 `bob_audit_events` 中。驳回要求意见，`unsubmit` 和 `unapprove` 要求原因。

### 4.4 对象启停

`enabled` 属于稳定对象而不是版本，新对象默认启用。只有当前版本为 `EFFECTIVE` 时允许执行 `enable` 或 `disable`。禁用对象不可用于新的业务引用，历史单据保存的对象 ID、版本 ID 和快照不受影响。对象从有效状态撤销批准并重新批准后保留原启停值。

## 5. 领域动作

八类实体提供相同的十四个动作，共定义 112 条业务 API：

| 动作         | 路径                          | 说明                                      |
| ------------ | ----------------------------- | ----------------------------------------- |
| 查询         | `/bob/{entity}/query`         | 分页查询对象及当前版本摘要                |
| 查看         | `/bob/{entity}/get`           | 查看对象和指定版本详情                    |
| 新建         | `/bob/{entity}/create`        | 创建对象、首个草稿和明细                  |
| 保存草稿     | `/bob/{entity}/save`          | 保存 `DRAFT` 版本                         |
| 删除首版草稿 | `/bob/{entity}/delete`        | 物理删除满足 2.2 节全部条件的首版草稿聚合 |
| 提交审核     | `/bob/{entity}/submit`        | 转为 `PENDING`                            |
| 撤回提交     | `/bob/{entity}/unsubmit`      | `PENDING` 退回 `DRAFT`                    |
| 审核通过     | `/bob/{entity}/approve`       | 转为 `EFFECTIVE`                          |
| 撤销批准     | `/bob/{entity}/unapprove`     | 冻结旧有效版本并复制新的 `PENDING` 版本   |
| 审核驳回     | `/bob/{entity}/reject`        | `PENDING` 退回 `DRAFT`                    |
| 启用         | `/bob/{entity}/enable`        | 允许有效对象被新业务引用                  |
| 禁用         | `/bob/{entity}/disable`       | 禁止有效对象被新业务引用                  |
| 查看版本     | `/bob/{entity}/versions`      | 查询对象全部历史版本                      |
| 审核记录     | `/bob/{entity}/audit-history` | 查询状态与审核事件                        |

每条路径都是独立 APP 权限。后端通过路由元数据绑定权限标识，禁止 Handler 自行用字符串前缀或角色名称判断权限。迁出的辅助对象使用 `/aux/{entity}/{action}` 权限，不再登记新的 BOB 权限。

## 6. 动作语义与约束

### 6.1 查询

请求示例：

```json
{
  "page": 1,
  "pageSize": 20,
  "filters": {
    "keyword": "示例",
    "status": ["DRAFT", "PENDING", "EFFECTIVE"]
  },
  "sort": [{ "field": "updatedAt", "order": "desc" }]
}
```

成功响应 `data`：

```json
{
  "items": [
    {
      "objectId": "01J...",
      "entity": "customer",
      "objectRevision": 3,
      "currentVersion": {
        "versionId": "01J...",
        "version": 2,
        "status": "PENDING",
        "revision": 4,
        "submittedBy": "01J...",
        "summary": {}
      },
      "effectiveVersionId": null,
      "updatedAt": "2026-07-22T10:00:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

`submittedBy` 在未提交版本中为 `null`，客户端用它阻止提交人审核自己的当前版本。各实体必须定义允许过滤、排序和关键字匹配的字段白名单。客户端字段名和排序方向不得拼接进 SQL；`pageSize` 必须设上限。

通用过滤字段为 `keyword`、`status`；类型化过滤字段包括 `customerType`、`supplierType`、`categoryId`、`departmentId`、`positionId`、`salespersonEmployeeId` 和 `currency`。后端按实体维护白名单并拒绝有值的无关筛选字段：客户和供应商支持业务员，员工支持部门和岗位，产品支持产品分类，资金账户支持币种。

`keyword` 在 `code`、`name` 和该实体适合展示的常用属性中匹配；车辆额外匹配 `plateNumber`，资金账户不匹配 `accountNumber`。`status` 最多包含五个合法状态。排序数组最多一个元素，字段白名单为 `updatedAt`、`code`、`name`、`status`、`version`，方向只能是 `asc` 或 `desc`；默认按 `updatedAt desc`，并以对象 ID 作为稳定次序。`pageSize` 范围为 1–100。

资金账号只在 `get` 和 `versions` 响应中返回完整值；`query` 摘要和 `ResolveEffectiveReference` 必须清空 `accountNumber`，也不得把账号纳入关键字搜索。

### 6.2 查看

请求可以指定某一历史版本；未指定时读取 `current_version_id`：

```json
{
  "objectId": "01J...",
  "versionId": "01J..."
}
```

后端必须校验 `versionId` 属于 `objectId` 且实体与路径一致。响应返回对象元数据、版本元数据和当前实体的类型化 `data`，不得仅凭版本 ID 跨实体读取数据。

### 6.3 新建

请求示例：

```json
{
  "data": {}
}
```

成功后创建稳定对象、版本号 1 的 `DRAFT` 版本和类型化明细，返回：

```json
{
  "objectId": "01J...",
  "objectRevision": 1,
  "versionId": "01J...",
  "version": 1,
  "status": "DRAFT",
  "revision": 1
}
```

对象、版本、明细和 `CREATED` 审计事件必须在单个事务中写入。

### 6.4 反向与启停

`unsubmit` 和 `unapprove` 请求：

```json
{
  "objectId": "01J...",
  "objectRevision": 2,
  "versionId": "01J...",
  "revision": 4,
  "reason": "退回修改"
}
```

`unsubmit` 只允许当前 `PENDING` 版本退回 `DRAFT`。`unapprove` 只允许当前 `EFFECTIVE` 版本执行：旧版本冻结为 `INVALID`，业务明细复制到版本号递增的新 `PENDING` 版本。两者都要求原因并写入审计。

`enable` 和 `disable` 请求只包含 `objectId`、`objectRevision`。只有当前版本为 `EFFECTIVE` 时允许启停，成功后对象 `revision + 1`；重复启用或重复禁用按数据冲突处理。

### 6.5 保存草稿

请求：

```json
{
  "objectId": "01J...",
  "versionId": "01J...",
  "revision": 2,
  "data": {}
}
```

只允许保存 `DRAFT`。更新必须匹配 `versionId`、`objectId`、实体、允许状态和 `revision`，成功后 `revision + 1`。客户端不能修改 `version`、`status` 和任何审计字段。

新增可选属性按 2.1 节执行省略保持、显式 `null` 或空字符串清空。该语义保证旧客户端保存名称等既有字段时不会误删后端已经保存的新资料。

### 6.6 删除首版草稿

请求：

```json
{
  "objectId": "01J...",
  "objectRevision": 1,
  "versionId": "01J...",
  "revision": 1
}
```

成功响应的 `data` 固定为 `null`。URL 中的 `entity`、对象和版本必须一致，并满足 2.2 节全部条件。`objectRevision` 保护稳定对象，`revision` 保护当前版本；任一 revision 过期、状态改变、出现新版本、产生生命周期历史或发现外部引用时均返回现有数据冲突类别，不执行部分删除。

`delete` 是独立精确权限。迁移只登记 `/bob/{entity}/delete` 权限，不自动授予任何已有角色；管理员必须显式评估并授权。

### 6.7 提交审核

请求：

```json
{
  "objectId": "01J...",
  "versionId": "01J...",
  "revision": 3
}
```

提交前重新执行该实体的完整业务字段、唯一性和关联有效性校验。只有 `DRAFT` 可提交。事务内更新状态、提交人/时间、版本 `revision` 并写入 `SUBMITTED` 事件。

### 6.8 审核通过

请求：

```json
{
  "objectId": "01J...",
  "versionId": "01J...",
  "revision": 4
}
```

事务内必须：

1. 锁定对象和目标版本；
2. 校验目标是对象当前版本、状态为 `PENDING` 且 `revision` 匹配；
3. 校验当前用户不是该次提交人；系统用户执行自动种子数据流程时例外；
4. 重新校验关键唯一性和关联约束；
5. 将版本改为 `EFFECTIVE`；
6. 设置 `effective_version_id` 并增加对象 `revision`；
7. 写入审核字段和 `APPROVED` 事件。

### 6.9 审核驳回

请求与审核通过相同，但 `comment` 必填且必须满足长度限制。只有当前 `PENDING` 版本可驳回，提交人不能审核自己的提交。事务内退回 `DRAFT`、清空版本行上的最近提交审核字段并写入 `REJECTED` 事件；对象的 `effective_version_id` 保持为空。

### 6.10 版本与审核历史

`versions` 请求：

```json
{
  "objectId": "01J...",
  "page": 1,
  "pageSize": 20
}
```

按 `version_no desc` 返回版本元数据和展示摘要。`audit-history` 使用相同分页结构，按事件发生时间和事件 ID 稳定倒序。读取历史详情仍需对应 `get`、`versions` 或 `audit-history` 权限策略明确授权，不能因知道 ID 绕过实体权限。

## 7. 并发与事务规则

### 7.1 乐观并发

- 对象级动作使用 `objectRevision`；
- 版本内容及状态动作使用版本 `revision`；
- 更新 SQL 必须把预期 revision 放入 `WHERE` 条件；
- revision 不匹配返回稳定“数据冲突”业务码，并返回最少必要的当前版本信息供前端刷新；
- 重复提交、重复审核、保存已经变为待审核的数据都属于冲突，不得按成功处理。

### 7.2 数据库锁

创建新版本、编辑、删除首版草稿、提交、审核通过和审核驳回必须在事务内按固定顺序锁定对象行，再锁定版本行，避免死锁和交错状态流转。部分唯一索引作为最后一致性防线；约束冲突应转换为领域冲突，不能把 PostgreSQL 错误文本返回客户端。

### 7.3 幂等边界

读接口天然幂等。状态写操作默认采用 revision 防止重复执行，不应把第二次审核伪装为首次成功。若客户端重试需求引入幂等键，应统一使用请求幂等表并限定作用域、有效期和响应重放规则，不能由各实体自行实现不同语义。

## 8. 有效引用规则

交易领域创建新记录时，必须同时保存：

- `object_id`：稳定对象标识；
- `version_id`：业务发生时引用的版本标识；
- 交易领域要求的名称、编码、税务信息等业务快照。

BOB 提供内部领域能力 `ResolveEffectiveReference(entity, objectId, versionId)`。交易写入必须在自身数据库事务中调用该能力，并确认：

1. 对象和版本存在且实体匹配；
2. `bob_objects.effective_version_id = versionId`；
3. 版本状态为 `EFFECTIVE`；
4. 当前操作者满足必要的数据范围规则。

需要按对象读取其当前有效版本时，内部调用方使用 `ResolveCurrentEffectiveReference(entity, objectId)`；该能力遵循相同的事务共享锁与有效性规则，VOU 仅用它解析客户或供应商配置的默认员工。

解析车辆有效引用时，还必须在同一事务内确认 `platformObjectId` 指向的供应商存在当前 `EFFECTIVE` 版本，且该版本 `supplierType=LOGISTICS_PLATFORM`。车辆和平台对象的共享锁保持到消费方事务结束，防止校验后平台立即进入编辑状态。

AUX 产品分类、部门、岗位，以及 BOB 结算方式、负责人和业务员引用在引用方的创建、保存、提交和审核阶段校验。VOU 使用客户或供应商业务员作为新单据默认值时，会在同一事务内另行解析该员工的当前有效版本。资金账户有效引用不返回完整账号。

仅在前端下拉框加载时有效不构成写入保证。为避免“校验后、交易写入前”发生编辑失效，交易事务应对对象行取得与 BOB 编辑更新互斥的共享锁，或采用经验证的等效数据库约束/串行化方案。

已经保存的历史业务引用不因版本后续变为 `INVALID` 而失效、级联更新或删除。BOB 表禁止配置会破坏历史引用的级联删除。

## 9. 校验与唯一性

校验分为三层：

1. **传输校验**：JSON 类型、必填字段、长度、枚举和 ID 格式；
2. **实体校验**：各实体字段组合、精度、编码规则和条件必填；
3. **领域校验**：状态、提交人与审核人分离、唯一性、关联对象有效性和并发版本。

`code` 在同一实体的稳定对象间唯一。税号、条码、VIN、资金账号和车牌执行“当前版本唯一”：草稿、待审、驳回和有效的当前版本都占用，失效的历史版本释放。数据库约束与事务锁负责并发兜底，约束冲突统一映射为领域数据冲突。

## 10. 权限与审计

- 所有接口先由 APP 中间件校验会话、CSRF 和完整 API 路径权限；
- 每个动作独立授权；菜单准入不依赖 `query`，缺少某动作权限时前端不得发起对应请求；
- `delete` 是独立的高风险精确权限，不随 `create`、`edit` 或 `save` 自动授予；
- `approve` 与 `reject` 只授予审核角色，且仍需执行提交人与审核人分离校验；
- 后端从会话取得操作者，拒绝客户端传入 `createdBy`、`submittedBy` 或 `reviewedBy`；
- 保存动作的变更摘要与每次状态流转写入审计事件；
- 日志记录 `requestId`、实体、对象 ID、版本 ID、动作和结果类别，不记录完整税号、账号、联系方式等敏感业务字段；审计摘要只记录字段名和状态，不记录这些字段的完整值；
- 若未来引入数据范围权限，必须在列表和单对象读取中同时实施，防止通过 ID 绕过。

## 11. 错误分类

领域错误映射到项目统一稳定业务类别：

| 场景                                      | 类别                                  |
| ----------------------------------------- | ------------------------------------- |
| 会话不存在或失效                          | 未登录                                |
| 缺少精确动作权限                          | 无权限                                |
| JSON、字段或状态参数非法                  | 参数校验失败                          |
| revision 过期、状态已变化、候选版本已存在 | 数据冲突                              |
| 对象或版本不存在，或不属于路径实体        | 未找到或参数失败，按统一 API 契约固定 |
| 数据库或未知异常                          | 内部异常                              |

错误消息不能包含 SQL、约束名、堆栈、内部路径或敏感字段。对于调用者无权知道是否存在的对象，应统一表现为无权限或不可见，避免 ID 枚举。

## 12. 测试验收

每一种 BOB 实体复用同一组生命周期契约测试，并补充实体字段测试。至少覆盖：

1. 新建对象只产生 `DRAFT`，不能被有效引用；
2. 草稿提交、审核通过及提交人不能自审；
3. 审核驳回、修改和重新提交保留完整事件历史；
4. 编辑有效对象在同一事务内使旧版本失效并创建新草稿；
5. 编辑事务失败时旧有效版本保持有效；
6. 新版本待审或被驳回时旧版本不自动恢复；
7. 同一对象并发撤销批准只能有一个成功；
8. 过期 revision 的保存、提交和审核返回数据冲突；
9. 每个对象最多一个有效版本和一个候选版本；
10. 交易写入不能引用无效、待审、草稿或对象已禁用的版本；
11. 历史引用和快照不受后续版本状态变化影响；
12. 无权限用户不能通过查询、详情或猜测 ID 读取数据；
13. 数据库约束错误被转换为稳定业务错误且事务完整回滚。
14. 物流平台撤销批准期间相关车辆不能被新业务引用，平台重新生效后恢复；
15. 当前车辆车牌并发唯一，车辆编辑后的历史车牌允许被其他车辆重新使用；
16. 有当前车辆引用的物流平台不能改为普通供应商。
17. 合法首版草稿删除后对象、版本、类型化明细和允许删除的审计事件均不存在；
18. 非草稿、多个版本、曾提交或审核、曾生效、revision 过期及实体不匹配时拒绝删除；
19. BOB 车辆平台引用或任一 VOU 对象/版本快照引用存在时拒绝删除且数据保持完整；
20. 删除与保存或提交并发时最多一个动作成功，失败及事务中途异常不留下孤儿数据。
21. 产品分类、部门和岗位必须引用实体匹配且当前可用的 AUX 对象；结算方式必须引用当前启用且生效的 BOB 固定结算方式；
22. 产品分类只能被产品引用，其他 BOB 实体不能保存通用分类；
23. AUX 对象停用或修改不追溯改变已经生效的 BOB 版本，但阻止后续草稿保存或审核；
24. 税号、条码、VIN 和资金账号经过规范化并满足当前版本唯一，历史版本释放后可复用；
25. 旧请求保存时保留新增可选字段，显式 `null` 或空字符串能够清空；
26. 资金账号只在详情和版本历史返回，查询、关键字搜索、有效引用、审计和日志不暴露完整账号；
27. 8 类实体共注册 112 条路由，权限精确匹配且不自动授予普通角色；
28. 启停只影响新引用，历史引用与快照保持有效；
29. 撤销批准冻结旧版本并复制新版本，旧版本业务字段永久不再修改。

## 13. 待决事项

- 客户与供应商是否共享“业务伙伴”主体；
- 员工与 APP 用户及组织的后续关联方式；
- 产品与服务后续的价格、税率和多币种属性；
- 仓库与组织、地址、库区、库位及库存核算范围的后续关联方式；
- 车辆后续的车型目录、证照、司机、轨迹和调度属性；
- 物流平台后续是否需要自营、临时、外部等结构化分类；
- 资金账户后续的账户类型、字段级加密和更细的数据可见范围；
- 是否需要多级审核及委托审核；
- 历史版本和审计记录的保留、归档和脱敏策略。

## 14. 前端职责与交互约束

本节保留前端页面、状态和交互层必须遵守的领域约束；HTTP 线协议以根目录 OpenAPI 为准。

### 14.1 客户交互语义

列表、详情、写入结果和字段类型直接使用 OpenAPI 生成类型。前端不得维护 `CustomerData`、变更结果或请求体的手写副本。

结算方式和业务员分别引用当前启用且生效的 BOB `settlement-method` 和 `employee` 对象。它们与月结日一起保存为客户主数据默认值，由 VOU 在制单时解析并保存快照。结算方式固定为系统预置的 11 类，不允许新增或删除；只允许通过撤销批准产生新版本并修改客户销售加价，修改只影响之后创建或显式重选结算方式的订单。

除名称、客户类型、月结日和业务员外的客户字段可以清空；省略字段与显式清空的语义按 2.1 节执行。客户类型新建时默认为 `DIT-0001`，月结日默认为 `31`，业务员必须引用有效员工且不可清空。

### 14.2 统一实体交互

全部实体使用 OpenAPI 定义的统一对象、版本、分页和变更结果结构，并由前端本地
配置声明各自的展示与编辑字段。前端已注册 `customer`、`supplier`、
`employee`、`product`、`service`、`warehouse`、`vehicle`、
`fund-account` 页面，统一使用共享 BOB 页面和 ViewModel，支持第 7 节
的十四个动作。

引用字段使用目标实体的稳定 `objectId`。编辑器和筛选器只通过目标实体
`query` 查询可引用对象，显示“编码 · 名称”，不使用本地假数据。
产品分类、部门和岗位通过 AUX 查询，结算方式通过 BOB 查询，车辆物流平台额外限定
`supplierType=LOGISTICS_PLATFORM`。

客户和供应商的 `salespersonEmployeeId` 均为必填员工引用。创建和保存时必须
发送该字段；前端缺少员工查询权限或员工列表加载失败时显示明确错误并阻止
提交空引用。

### 14.3 权限

每个 BOB 实体至少支持以下操作权限：

- 查看；
- 新建；
- 编辑；
- 删除满足条件的首版草稿；
- 提交审核；
- 审核通过；
- 审核驳回；
- 查看历史版本和审核记录。

前端权限只控制菜单、按钮和交互可见性，所有状态流转和操作权限必须由后端再次校验。

### 14.4 与其他领域的关系

- BOB 向其他领域提供有效基础对象的查询和引用能力。
- 交易领域创建新业务记录时，只能选择 `EFFECTIVE` 版本。
- BOB 不负责决定交易领域如何处理已经引用了失效版本的历史单据。
- 其他领域不得绕过 BOB 的审核状态自行将对象视为有效。
- 领域间使用对象标识和版本标识关联，不依赖可变的名称或编码建立关系。
