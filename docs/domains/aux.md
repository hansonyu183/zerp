# AUX 辅助对象领域

## 1. 领域边界

AUX（Auxiliary Object）管理会被业务规则或其他对象引用、但不独立形成交易的辅助对象。固定领域标识为 `aux`，当前实体为：

```text
product-category
product-type
department
position
settlement-method
payment-method
dictionary-type
dictionary-item
measurement-unit
income-expense-type
asset-category
```

不具有明确业务语义和用途的“通用分类”或字典不得建立。字典只归集不参与业务逻辑的稳定选项；客户类型、车辆类型可由字典提供，币种仍是业务枚举。物流服务不再通过供应商类型表达。

本文中的对象名称、字段和持久化规则只定义目标领域模型，不自行声明当前 HTTP 接口。只有根目录 OpenAPI 已同步定义的实体、路径和数据结构才构成线协议。

## 2. Approval + Versioning 生命周期

全部 AUX 实体使用中央 Approval + Versioning。稳定对象只保存 `id`、`entity`、`code`、`enabled` 和对象级 `revision`；业务数据按 `approval_entry_id` 保存。生命周期和元数据只来自 Approval：`DRAFT -> PENDING -> APPROVED`，动作只有 `submit`、`unsubmit`、`reject`、`approve`、`unapprove`。不存在 AUX 自有状态机、当前版本指针、下一版本号或重复审批审计。

- 新建产生 V1 `DRAFT`；只有 `APPROVED` 版本可供正式业务引用。
- 修改最新批准版本产生下一个 `DRAFT` 候选。候选提交、驳回或保存期间，最后批准版本持续供业务使用；候选批准后按最大批准版本号自动成为最新批准版本。
- 同一稳定对象最多一个 `DRAFT`/`PENDING` 候选；删除候选不消耗版本号。只允许反批最新批准版本，且已有开放候选时在 `Prepare` 阶段返回 `approval_open_version_exists`；V2 反批后 V1 自动回落为最新批准版本，V1 反批后该对象没有正式版本。反批引用 blocker 只匹配目标 `approvalEntryId` 的当前正式 BOB 快照和现存 VOU 快照，旧版本快照不阻断未被引用的新版本。
- `code` 由服务端生成且创建后不可修改。`enabled` 是对象级状态；停用立即阻止新引用，但不修改审批状态和历史快照。
- 删除只适用于 `DRAFT`：没有批准历史的 V1 草稿删除时同时删除稳定对象；已有批准历史时只删除候选。审批历史、批准版本和已被引用对象不得物理删除。
- 树形对象禁止自引用和循环引用。候选不预约正式唯一资源、不构成父子或字典正式事实；`approve` 必须在同一事务中重新校验树、字典归属、唯一性以及所有可能漂移的引用。
- Approval entry 的 `revision` 保护保存和生命周期动作；对象 `revision` 只保护启停等稳定对象变更。AUX JSONB 图写入仍在事务内取得 AUX 域写锁，Approval 同时按 `(aux, entity, subject_id)` 串行化版本操作。
- 系统 baseline 由受信任系统身份完整执行创建、提交和批准，形成 V1 `APPROVED`；受信任身份不能绕过状态机、业务校验、revision 或事务不变量。

公开动作、路径和请求响应结构以 [OpenAPI AUX Schema](../../contracts/openapi/schemas/aux.yaml) 为准。

## 3. 对象规则

对象编码格式固定为 `PPP-NNNN`，其中 `PPP` 是三位对象前缀，`NNNN` 是按实体永久递增且
不复用的四位流水号。达到 `9999` 后拒绝继续创建。前缀固定为：

```text
product-category PCT         department DEP
position POS                 product-type PTP
dictionary-type DCT          dictionary-item DIT
measurement-unit UNT         income-expense-type IET
asset-category ACT
settlement-method STM
payment-method PMT
```

### 3.1 产品分类

`product-category` 只服务产品，不再使用含义宽泛的跨对象分类。字段为 `name`、`parentId`、`description`；`parentId` 形成单父多级树。

#### 3.1.1 产品类型

`product-type` 是可扩展的扁平辅助对象，字段为 `name`、`behaviorProfile` 和 `description`。业务用户可以创建多个产品类型，并为每个类型选择一个系统内置行为模板；产品类型不保存任意规则开关，也不替代用于层级归集的产品分类。

当前系统内置行为模板为 `RAW_MATERIAL`、`STANDARD_FINISHED`、`CUSTOM_FINISHED` 和 `PACKAGING`。新增同类业务名称只创建新的产品类型并复用现有模板；出现现有模板无法表达的新业务行为时，必须先扩展领域规则和系统实现，不能由管理员拼装新的行为组合。

产品类型一旦被任一正式 BOB 产品版本引用，`behaviorProfile` 永久不可修改；候选引用不构成正式占用。需要另一种行为时新建产品类型，再通过产品候选版本改选。名称和说明通过新的 AUX 候选版本修改，停用只阻止新选择和新的产品候选版本提交或批准，不追溯改变已经批准的产品或历史 VOU。产品类型不建立父子关系，也不允许一个产品同时选择多个类型。

### 3.2 部门与岗位

`department` 是独立树形对象，字段为 `name`、`parentId`、`description`，为未来按部门配置业务规则保留稳定引用。`position` 字段为 `name`、`description`；本阶段只提供岗位身份，不在 AUX 中保存工资公式，工资计算规则由未来薪资领域拥有。

### 3.3 结算方式

`settlement-method` 是固定结算方式辅助对象。系统只维护 11 个对象：`PREPAID` 预付、`CASH_ON_DELIVERY` 现结（货到付款）、`ARRIVAL_3/5/7/15/30` 货到 N 天、`MONTHLY_CURRENT` 当月结、`MONTHLY_30/60/90` 月结 30/60/90 天。禁止创建、删除或增加第 12 种方式。

字段为 `name`、`termCode`、`ruleType`、`monthOffset`、`dayOfMonth`、`dayOffset`、`defaultSalesSurcharge` 和 `description`。名称、术语代码和到期计算参数是系统固定事实；页面只允许修改非负、最多两位小数的元/kg 默认销售加价和说明，并可启用或停用。初始销售加价依次为：预付、现结、货到 3/5/7/15 天均为 `0.00`；货到 30 天 `0.10`；当月结 `0.05`；月结 30/60/90 天为 `0.10/0.20/0.30`。本字段只适用于客户销售；供应商结算快照中的该项固定为零，不限制专门采购单据自行维护的采购费用。

客户选择当前启用的结算方式时，直接把 `settlementMethodId`、`code`、`name`、`termCode`、`ruleType`、`monthOffset`、`dayOfMonth`、`dayOffset` 和 `defaultSalesSurcharge` 保存进客户版本，不保存结算方式版本 ID。保存后这些值是客户自身的结算事实；辅助对象后续改名、调价、停用或产生新版本均不改变客户，只有客户显式重新选择时才复制新值。

### 3.4 收款方式

`payment-method` 表达客户采用什么付款媒介，不表达何时付款；预付、现结、货到若干天和月结规则仍只属于结算方式。

字段为 `name`、`defaultSalesSurcharge` 和 `description`。对象可配置创建、修改、启停和在未被引用时删除，不把 OIT/KY 的承兑代码或混合字段名固化成协议枚举。`defaultSalesSurcharge` 为非负、最多两位小数的元/kg 定点字符串，默认 `0.00`。

客户选择当前启用的收款方式时，直接把 `paymentMethodId`、`paymentMethodCode`、`paymentMethodName` 和 `paymentMethodSalesSurcharge` 保存进客户版本，不保存收款方式版本 ID。来源后续改名、调价、停用或产生新版本均不追溯改变客户；客户显式重新选择时才整体替换。新销售订单默认复制客户快照，制单人可以改选另一当前启用的收款方式，订单保存最终方式和加价快照。

### 3.5 计量单位

`measurement-unit` 字段仅为 `name`、`symbol` 和 `quantityScale`。单位名称和符号用于录入与显示，`quantityScale` 决定该单位允许录入和保存的小数位。AUX 不管理计量维度、基准单位、基准单位 ID 或通用换算比例；相同单位名称在不同产品中可以对应不同的实际换算。

产品和服务通过对象 ID 引用计量单位。普通商品仍以 kg 计价，包装物按自身计价单位计价；计价单位和默认录入单位是用户可见语义，产品内部基准单位不是计量单位对象。所有产品单位换算都由 BOB 产品页面使用，不进入 AUX 或其他领域的业务规则。

### 3.6 字典

`dictionary-type` 只归集不参与逻辑的选项集合；`dictionary-item` 通过 `dictionaryTypeCode` 归属字典类型，并提供 `sortOrder`。字典项一旦被引用，其编码不可修改；名称、顺序和启停状态仍可维护。

### 3.7 收支类型

`income-expense-type` 是收入或支出的树形业务分类，字段为 `direction`、`parentId` 和 `description`。父子方向必须一致；只有叶子节点可被单据使用。它表达业务收支分类，不保存会计科目或会计映射。

会计科目按账簿归 ACC 领域管理；VOU 到科目的映射也由 ACC 按账簿维护。AUX 不提供全局会计科目树或跨账簿科目映射。

### 3.8 资产类别

`asset-category` 为固定资产购置和台账提供稳定分类。字段为 `name`、`defaultUsefulLifeMonths`、`defaultResidualRate` 和 `description`；默认使用期限为 1–1200 个自然月，默认残值率为 `0.00`–`99.99`。购置单选择类别后默认带入这两个值，允许在单据行覆盖，历史资产保留购置时快照。

## 4. 数据与引用

`aux_objects` 只保存稳定身份、编码、启停和对象 revision；`aux_version_payloads` 以 `approval_entry_id` 保存严格白名单校验的类型化 JSON 数据。Approval 的 `approval_entries` 是唯一版本头，`approval_events` 是唯一审批生命周期审计。AUX 只为启停等对象级领域变化保存领域事件，不复制 Approval 状态、操作者或时间。

BOB、VOU 和 ACC 在同一 PostgreSQL 事务中解析 AUX 引用：先锁定稳定对象，再只选择该 subject 中版本号最大的 `APPROVED` entry；调用方指定 `approvalEntryId` 时，该 entry 必须正是最新批准版本。不存在批准版本、对象已停用或传入候选 entry 时拒绝，不得回退到最新创建版本、任意最大版本或旧指针。

历史批准版本永不被后续保存覆盖；停用、改名、候选版本或新的批准版本不会改写既有交易快照。结算方式在客户或供应商显式选择时解析，收款方式只在客户显式选择时解析；引用方按 3.3 和 3.4 节保存自足快照，后续提交、批准和制单不递归解析来源版本。客户结算快照保存销售加价，供应商结算快照不保存销售加价；委托配制制造费等采购加价由对应专门采购单据维护，不进入 AUX 或供应商主数据。
