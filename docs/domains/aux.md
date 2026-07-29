# AUX 辅助对象领域

## 1. 领域边界

AUX（Auxiliary Object）管理会被业务规则或其他对象引用、但不独立形成交易的辅助对象。固定领域标识为 `aux`，当前实体为：

```text
product-category
department
position
settlement-method
dictionary-type
dictionary-item
measurement-unit
income-expense-type
account-subject
```

不具有明确业务语义和用途的“通用分类”或字典不得建立。字典只归集不参与业务逻辑的稳定选项；客户类型、车辆类型可由字典提供，供应商类型和币种仍是业务枚举。

## 2. 统一生命周期

辅助对象创建后立即生效，不走 BOB 的提交审核状态机。每次保存追加一个不可变版本，并把当前版本切换到新版本；交易领域必须保存对象 ID、版本 ID、编码和名称快照。

- `code` 由服务端生成，创建后不可修改。
- 对象可启用或停用；停用后不可用于新的引用，历史快照不受影响。
- 只有从未被引用的对象才允许删除。
- 树形对象禁止自引用和循环引用。
- 所有写入使用对象 `revision` 做乐观并发控制，并追加审计事件。由于 AUX
  内部树和业务映射保存在 JSONB 中，创建、保存、启停和删除还必须在事务内
  取得 AUX 域写锁，使引用校验与写入串行化，避免并发产生循环或悬空引用。

统一动作是：

```text
query get create save enable disable delete versions audit-history
```

## 3. 对象规则

对象编码格式固定为 `PPP-NNNN`，其中 `PPP` 是三位对象前缀，`NNNN` 是按实体永久递增且
不复用的四位流水号。达到 `9999` 后拒绝继续创建。前缀固定为：

```text
product-category PCT         department DEP
position POS                 settlement-method STM
dictionary-type DCT          dictionary-item DIT
measurement-unit UNT         income-expense-type IET
account-subject ACS
```

### 3.1 产品分类

`product-category` 只服务产品，不再使用含义宽泛的跨对象分类。字段为 `name`、`parentId`、`description`；`parentId` 形成单父多级树。

### 3.2 部门与岗位

`department` 是独立树形对象，字段为 `name`、`parentId`、`description`，为未来按部门配置业务规则保留稳定引用。`position` 字段为 `name`、`description`；本阶段只提供岗位身份，不在 AUX 中保存工资公式，工资计算规则由未来薪资领域拥有。

### 3.3 结算方式

结算方式会影响单据到期日和销售价格，不是字典。字段为：

- `ruleType`：`DUE_DAYS` 或 `MONTH_END`；
- `dueDays`：`DUE_DAYS` 的自然日天数；
- `cutoffDay`：`MONTH_END` 的月内截止日，取 `1–31`；
- `monthOffset`：目标结算月偏移，取 `0–120`；
- `defaultSalesSurcharge`：销售商品默认加价，单位为元/kg，非负两位小数；
- `description`。

`DUE_DAYS` 到期日为业务日期加 `dueDays`。`MONTH_END` 先判断业务日期是否超过 `cutoffDay`，超过则额外顺延一个月，再叠加 `monthOffset`，最后取目标月月末。销售订单对非包装物商品自动带入默认加价；包装物不加价。单据保存结算方式和加价快照。

### 3.4 计量单位

`measurement-unit` 字段为 `name`、`symbol`、`quantityScale`。产品和服务通过对象 ID 引用计量单位。普通商品定价单位固定为 kg，产品通过 `pricingQuantityPerInventoryUnit` 描述每库存单位折合的 kg 数；包装物按自身库存单位定价。

### 3.5 字典

`dictionary-type` 只归集不参与逻辑的选项集合；`dictionary-item` 通过 `dictionaryTypeCode` 归属字典类型，并提供 `sortOrder`。字典项一旦被引用，其编码不可修改；名称、顺序和启停状态仍可维护。

### 3.6 收支类型

`income-expense-type` 是收入或支出的树形业务分类，字段为 `direction`、`parentId`、`accountSubjectId` 和 `description`。父子方向必须一致；只有叶子节点可被单据使用，叶子必须关联当前有效的会计科目。它不自动生成会计凭证，只为未来自动记账保存稳定映射。

`account-subject` 管理会计科目树，方向为资产、负债、权益、收入、费用或成本。本阶段只建立科目与收支类型的稳定映射，不生成会计凭证，也不预置生产科目。

## 4. 数据与引用

`aux_objects` 保存稳定对象和当前版本指针，`aux_versions` 保存版本及类型化 JSON 数据，`aux_audit_events` 保存追加式审计。虽然明细采用 JSONB，不同实体的允许字段、类型、范围和交叉约束必须由服务端严格白名单校验。

BOB、VOU 和 LED 在同一 PostgreSQL 事务中解析辅助对象引用并对稳定对象取得共享锁。历史版本永不被后续保存覆盖；停用、改名或新版本不会改写既有交易快照。
