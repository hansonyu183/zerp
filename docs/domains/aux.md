# AUX 辅助对象领域

## 1. 领域边界

AUX（Auxiliary Object）管理会被业务规则或其他对象引用、但不独立形成交易的辅助对象。固定领域标识为 `aux`，当前实体为：

```text
product-category
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

不具有明确业务语义和用途的“通用分类”或字典不得建立。字典只归集不参与业务逻辑的稳定选项；客户类型、车辆类型可由字典提供，供应商类型和币种仍是业务枚举。

本文中的对象名称、字段和持久化规则只定义目标领域模型，不自行声明当前 HTTP 接口。只有根目录 OpenAPI 已同步定义的实体、路径和数据结构才构成线协议。

## 2. 统一生命周期

辅助对象创建后立即生效，不走 BOB 的提交审核状态机。每次保存追加一个不可变版本，并把当前版本切换到新版本；引用方通常保存对象 ID、版本 ID、编码和名称快照。结算方式和收款方式是明确例外：客户版本保存来源对象 ID 及全部关键值，但不保存或依赖来源版本 ID。

- `code` 由服务端生成，创建后不可修改。
- 对象可启用或停用；停用后不可用于新的引用，历史快照不受影响。
- 只有从未被引用的对象才允许删除。
- 树形对象禁止自引用和循环引用。
- 所有写入使用对象 `revision` 做乐观并发控制，并追加审计事件。由于 AUX
  内部树和业务映射保存在 JSONB 中，创建、保存、启停和删除还必须在事务内
  取得 AUX 域写锁，使引用校验与写入串行化，避免并发产生循环或悬空引用。

公开动作、路径和请求响应结构以 [OpenAPI AUX Schema](../../contracts/openapi/schemas/aux.yaml) 为准。

## 3. 对象规则

对象编码格式固定为 `PPP-NNNN`，其中 `PPP` 是三位对象前缀，`NNNN` 是按实体永久递增且
不复用的四位流水号。达到 `9999` 后拒绝继续创建。前缀固定为：

```text
product-category PCT         department DEP
position POS
dictionary-type DCT          dictionary-item DIT
measurement-unit UNT         income-expense-type IET
asset-category ACT
settlement-method STM
payment-method PMT
```

### 3.1 产品分类

`product-category` 只服务产品，不再使用含义宽泛的跨对象分类。字段为 `name`、`parentId`、`description`；`parentId` 形成单父多级树。

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

`measurement-unit` 字段为 `name`、`symbol`、`quantityScale`。产品和服务通过对象 ID 引用计量单位。普通商品定价单位固定为 kg，产品通过 `pricingQuantityPerInventoryUnit` 描述每库存单位折合的 kg 数；包装物按自身库存单位定价。

### 3.6 字典

`dictionary-type` 只归集不参与逻辑的选项集合；`dictionary-item` 通过 `dictionaryTypeCode` 归属字典类型，并提供 `sortOrder`。字典项一旦被引用，其编码不可修改；名称、顺序和启停状态仍可维护。

### 3.7 收支类型

`income-expense-type` 是收入或支出的树形业务分类，字段为 `direction`、`parentId` 和 `description`。父子方向必须一致；只有叶子节点可被单据使用。它表达业务收支分类，不保存会计科目或会计映射。

会计科目按账簿归 ACC 领域管理；VOU 到科目的映射也由 ACC 按账簿维护。AUX 不提供全局会计科目树或跨账簿科目映射。

### 3.8 资产类别

`asset-category` 为固定资产购置和台账提供稳定分类。字段为 `name`、`defaultUsefulLifeMonths`、`defaultResidualRate` 和 `description`；默认使用期限为 1–1200 个自然月，默认残值率为 `0.00`–`99.99`。购置单选择类别后默认带入这两个值，允许在单据行覆盖，历史资产保留购置时快照。

## 4. 数据与引用

`aux_objects` 保存稳定对象和当前版本指针，`aux_versions` 保存版本及类型化 JSON 数据，`aux_audit_events` 保存追加式审计。虽然明细采用 JSONB，不同实体的允许字段、类型、范围和交叉约束必须由服务端严格白名单校验。

`aux_objects.oit_id` 仅作为旧 OIT 聚合根映射的数据库内部字段。非空值不得含首尾空格，长度为 1–64，且在同一 `entity` 内唯一；应用 HTTP/API/UI 不读取或写入它。

BOB、VOU 和 ACC 在同一 PostgreSQL 事务中解析辅助对象引用并对稳定对象取得共享锁。历史版本永不被后续保存覆盖；停用、改名或新版本不会改写既有交易快照。结算方式在客户或供应商显式选择时解析，收款方式只在客户显式选择时解析；引用方按 3.3 和 3.4 节保存自足快照，后续提交、审核和制单不递归解析来源版本。客户结算快照保存销售加价，供应商结算快照不保存销售加价；委托配制制造费等采购加价由对应专门采购单据维护，不进入 AUX 或供应商主数据。
