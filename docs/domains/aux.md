# AUX 辅助对象领域

## 1. 领域边界

AUX（Auxiliary Object）管理会被业务规则或其他对象引用、但不独立形成交易的辅助对象。固定领域标识为 `aux`，当前实体为：

```text
operating-entity
employee
warehouse
fund-account
vehicle
product-category
product-type
employee-category
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

本文中的对象名称、字段和持久化规则只定义领域模型，不自行声明 HTTP 接口；协议从 `apps/api/` 可执行 Hono/Zod 路由生成。

## 2. Stable-ID Direct CRUD 生命周期

全部 AUX 实体都是 current data。每个稳定对象在 `aux_objects` 一行内保存 `id`、`entity`、`code`、`enabled`、严格校验的 typed `data`、对象级 `revision` 和审计时间；不存在 Approval entry、候选、版本、审批状态或独立 payload 表。公开动作固定为 `create`、`get`、`query`、`save`、`enable`、`disable` 和 `delete`。

- 创建成功后对象立即成为启用的 current data，可供新 BOB/VOU 选择；`code` 由服务端生成且创建后永久不可修改。
- 保存直接替换同一 stable ID 的 typed data 并递增对象 `revision`。十进制字符串 `revision` 同时保护保存、启停和删除，冲突必须拒绝，不做覆盖或合并。
- 停用立即阻止新引用，但已经固化在 BOB/VOU Submission 中的 typed snapshot 继续可读、可批准、可计算；重新启用恢复新选择。
- 只有完全没有任何持久化引用的对象才可物理删除。删除检查 BOB 所有版本状态与 current、VOU 所有持久化状态和其他引用，返回按来源聚合的结构化 blocker；不得自动清空、迁移或改写引用。
- 树形对象禁止自引用和循环引用；字典归属、同层唯一性、方向一致性和其他 typed 规则在同一事务内重新校验。AUX 写事务取得域写锁，保证校验与 current mutation 原子化。
- 系统 baseline 直接写入同一 current 模型；系统身份不能绕过 typed 校验、stable identity、revision 或引用 blocker。

### 2.1 管理查询与并发

全部 AUX 实体采用同一管理身份与并发语义。名称只有 typed data 中一份可写事实；列表的名称与拼音从当前名称派生。拼音复用后端纯转换工具，不另存拼音列或执行 AUX 回填。查询默认包含启用和停用对象，在完整授权集合对编码、拼音、名称作 OR 包含匹配，按编码和稳定 ID 升序排列后分页，每页 20 条，总数来自同一匹配集合；改名后检索立即采用新名称。计量单位查询额外接受可选的 `quantityScale`（0–6 整数），与 `keyword` 作 AND 匹配后再计算总数和分页；该筛选不扩展到其他 AUX 实体。

管理动作资格只有 `edit`、`enable`、`disable`，中文分别为编辑、启用、停用，由服务端结合精确权限和对象事实提供；布尔启用事实显示为启用或停用。动作资格不是执行授权，执行时重新检查。创建不接受服务端身份、编码、拼音、启用事实或 revision；保存只改变 typed data，不能夹带启停。管理输入不接受旧身份别名或数字 revision，所有 revision 运算保持大整数精度。引用候选与历史嵌入快照保留自身身份语义。

AUX 与 APP 用户、角色共同消费完整公共启停组件。组件参与 AUX 持有域写锁的外层事务，按输入校验、读取、revision 检查、状态转换检查、实体专有规则、CAS 写入和审计顺序执行。陈旧 revision 优先拒绝；同状态请求冲突且不写入、不增 revision。通用审计复用 `app_audit_events`，记录领域、实体、对象、操作者、前后启用事实、revision 和 requestId；专有规则、状态与审计失败整体回滚。`aux_objects` 仍保存唯一启用事实与对象 revision，不建立第二份状态或业务版本。

公开动作、路径和请求响应结构由 `apps/api/` 的可执行 Hono/Zod 路由生成。

## 3. 对象规则

对象编码格式固定为 `PPP-NNNN`，其中 `PPP` 是三位对象前缀，`NNNN` 是按实体永久递增且
不复用的四位流水号。达到 `9999` 后拒绝继续创建。前缀固定为：

```text
operating-entity OPE          employee EMP
product-category PCT         department DEP
position POS                 product-type PTP
employee-category ECT
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

产品类型一旦被任一持久化 BOB 产品版本引用，`behaviorProfile` 永久不可修改；需要另一种行为时新建产品类型，再通过产品候选版本改选。名称和说明直接保存到 current，停用只阻止新选择；已经保存了完整产品类型快照的候选仍按自身规则提交或批准，不追溯改变已批准产品或历史 VOU。产品类型不建立父子关系，也不允许一个产品同时选择多个类型。

### 3.2 人员类别、部门与岗位

`employee-category` 是扁平通用辅助对象，字段只有 `name`、`description`，供 AUX 员工直接维护时选择。它不预置基线值，不保存等级、薪酬、权限、组织归属或任意业务规则；停用只阻止新的员工引用选择，不改写员工已采用的类别快照与历史 VOU/ACC 快照。

`department` 是独立树形对象，字段为 `name`、`parentId`、`description`，为未来按部门配置业务规则保留稳定引用。`position` 字段为 `name`、`description`；本阶段只提供岗位身份，不在 AUX 中保存工资公式，工资计算规则由未来薪资领域拥有。

### 3.3 结算方式

`settlement-method` 是固定结算方式辅助对象。系统只维护 11 个对象：`PREPAID` 预付、`CASH_ON_DELIVERY` 现结（货到付款）、`ARRIVAL_3/5/7/15/30` 货到 N 天、`MONTHLY_CURRENT` 当月结、`MONTHLY_30/60/90` 月结 30/60/90 天。禁止创建、删除或增加第 12 种方式。

字段为 `name`、`termCode`、`ruleType`、`monthOffset`、`dayOfMonth`、`dayOffset`、`defaultSalesSurcharge` 和 `description`。名称、术语代码和到期计算参数是系统固定事实；页面只允许修改非负、最多两位小数的元/kg 默认销售加价和说明，并可启用或停用。初始销售加价依次为：预付、现结、货到 3/5/7/15 天均为 `0.00`；货到 30 天 `0.10`；当月结 `0.05`；月结 30/60/90 天为 `0.10/0.20/0.30`。本字段只适用于客户销售；供应商结算快照中的该项固定为零，不限制专门采购单据自行维护的采购费用。

客户选择当前启用的结算方式时，直接把 `settlementMethodId`、`code`、`name`、`termCode`、`ruleType`、`monthOffset`、`dayOfMonth`、`dayOffset` 和 `defaultSalesSurcharge` 保存进客户版本。保存后这些值是客户自身的结算事实；辅助对象后续改名、调价或停用均不改变客户，只有客户显式重新选择时才复制新值。

### 3.4 收款方式

`payment-method` 表达客户采用什么付款媒介，不表达何时付款；预付、现结、货到若干天和月结规则仍只属于结算方式。

字段为 `name`、`defaultSalesSurcharge` 和 `description`。对象可配置创建、修改、启停和在未被引用时删除；协议不固化承兑代码或其他混合字段名。`defaultSalesSurcharge` 为非负、最多两位小数的元/kg 定点字符串，默认 `0.00`。

客户选择当前启用的收款方式时，直接把 `paymentMethodId`、`paymentMethodCode`、`paymentMethodName` 和 `paymentMethodSalesSurcharge` 保存进客户版本。来源后续改名、调价或停用均不追溯改变客户；客户显式重新选择时才整体替换。新销售订单默认复制客户快照，制单人可以改选另一当前启用的收款方式，订单保存最终方式和加价快照。

### 3.5 计量单位

`measurement-unit` 字段仅为 `name`、`symbol` 和 `quantityScale`。单位名称和符号用于录入与显示，`quantityScale` 决定该单位允许录入和保存的小数位。AUX 不管理计量维度、基准单位、基准单位 ID 或通用换算比例；相同单位名称在不同产品中可以对应不同的实际换算。

符号必填，数量精度为 0–6 的整数，两端均合法。改名、修改符号或精度及启停只影响后续显式采用，既有产品和交易继续使用保存时的名称、符号和数量精度。

计量单位管理查询的每个摘要行除通用 `id`、`code`、`py`、`name`、`enabled`、`revision` 与动作资格外，还返回必有的 `symbol` 和 `quantityScale`；列表筛选使用同一当前 `quantityScale` 事实，不回查产品或交易快照。

产品和服务通过对象 ID 引用计量单位。普通商品仍以 kg 计价，包装物按自身计价单位计价；计价单位和默认录入单位是用户可见语义，产品内部基准单位不是计量单位对象。产品 candidate 选择单位时把 stable ID、code、name、symbol 与 `quantityScale` 一并保存；VOU 按所采用产品版本中的 `quantityScale` 校验录入数量，不回查 AUX。所有产品单位换算都由 BOB 产品页面维护，不进入 AUX 的通用规则。

### 3.6 字典

`dictionary-type` 只归集不参与逻辑的选项集合；`dictionary-item` 通过 `dictionaryTypeId` 归属字典类型，并提供 `sortOrder`。服务端同时冻结 `dictionaryTypeCode` 与 `dictionaryTypeName` 展示快照，筛选可以使用编码快照，但所有权、删除 blocker 和写入校验只使用稳定对象 ID。字典项一旦被引用，其编码不可修改；名称、顺序和启停状态仍可维护。

### 3.7 收支类型

`income-expense-type` 是收入或支出的树形业务分类，字段为 `direction`、`parentId` 和 `description`。父子方向必须一致；只有叶子节点可被单据使用。它表达业务收支分类，不保存会计科目或会计映射。

会计科目按账簿归 ACC 领域管理；VOU 到科目的映射也由 ACC 按账簿维护。AUX 不提供全局会计科目树或跨账簿科目映射。

### 3.8 资产类别

`asset-category` 为固定资产购置和台账提供稳定分类。字段为 `name`、`defaultUsefulLifeMonths`、`defaultResidualRate` 和 `description`；默认使用期限为 1–1200 个自然月，默认残值率为 `0.00`–`99.99`。购置单选择启用的类别时，在 VOU 资产行固化类别的 ID、编码、名称及两项默认值；单据行仍可覆盖实际使用月数和残值率。之后类别改名、调整默认值或停用不重解释既有资产，新单据不得选择已停用类别。

### 3.9 经营主体与员工

`operating-entity` 是我方实际承担合同、开票和收款责任的法人公司。保留法定名称 `legalName`、简称 `shortName`、税号 `legalIdentifier`、注册地址 `registeredAddress`、联系人及电话、开票抬头/地址/电话/开户行/账号和备注。税号按既有规则规范化为 18 位大写字母数字，并在经营主体内唯一；名称、电话不是唯一键。列表名称由简称（空时法定名称）派生，不能另写一份 `name`。

`employee` 独立保存身份类型、法定名称、显示名称、单一法定识别号、联系人、电话、地址、备注、任职日期、工作电话及邮箱。身份值保持 `PERSON`（个人）和 `ORGANIZATION`（组织），沿用既有身份校验；列表名称来自显示名称。员工类别、部门、岗位和任职经营主体在创建/保存时以 stable ID 选择，服务端在同一事务核对当前启用事实并冻结 typed snapshot。任职经营主体描述任职归属，不限制其他经营主体单据选择该员工。

两类对象不创建 Submission、Approval 或业务版本。`create` 默认启用，`save` 只修改内容；启停独立、即时生效。保存、revision、引用登记与审计在同一事务，陈旧 revision 和重复法定标识拒绝。停用只阻止新采用，已保存快照继续解释历史；物理删除必须没有任何持久化引用，包括历史版本、业务快照和 current 引用。

AUX 仓库负责人、BOB 客户默认主体/内部业务员、供应商采购员与主体集合、其他单位/合作方主体集合、车辆内部承运方及资金账户所属主体，以及 VOU/ACC/RPT 的直接选择均采用 AUX stable ID；采用时保存自身所需 typed snapshot，不再选择旧审批版本，也不因来源后续修改或停用改变已保存解释。必要旧精确 Approval 引用仅作为历史证据保存。

#### 3.9.1 历史事实与授权

稳定 ID、OPE/EMP 编码、创建审计和已保存历史快照不可重解释，编码计数不复用历史编号。历史 subject、版本与 Approval 只作为必要审计证据，不参与 current 查询或新写入。新建 Submission（包括从历史内容预填新表单）在提交时重新采用当前资料；原 Submission 的读取、审批和幂等重试只使用已保存快照。

资料读取、创建、保存、启停与物理删除分别精确授权；不从通用引用权限推导资料维护权，不把一个人的权限组合转授整个角色。

### 3.10 仓库、资金账户与车辆

三类对象均由 AUX 直接维护 current data，保存即时生效，启停独立，不创建 Approval 或业务版本。稳定 ID、编码、revision、审计及引用更新沿用本域规则，所有校验与写入处于同一事务。页面只保留临时输入，确定失败保留输入，关闭、刷新或切换账号后销毁。

仓库是全局共享的最小物理库存地点，不绑定经营主体。负责人可选，采用 AUX 员工 stable ID 与姓名快照，不授予权限。库存非零、进行中单据、来源或有效引用阻止停用，返回完整结构化 blocker；不得迁移库存或引用。库存、进行中单据与引用从当前事实读取。

资金账户必须属于一个当前启用的 AUX 经营主体。账号去除空白与连字符后转为大写，非空规范账号在本实体全部 current 对象间唯一；保存失败不改变账号占用、revision 或审计。收付款单据显式选择经营主体时（当前为销售收款），资金账户所属主体必须一致；未独立选择经营主体的收付款，以采用时资金账户快照中的所属主体作为该笔资金事实的经营主体。

车辆保留车牌、VIN、车型、核定载重及明确的散水承运能力。承运归属只有 INTERNAL（AUX 经营主体）与 EXTERNAL（其他单位）；其他单位通过当前真实读取及精确版本采用，不能建立 DCL 代理。车牌去除空白后转为大写，非空 VIN 仅去除首尾空白后转为大写，两者保留连字符，最长 64 字符，分别在车辆 current 名录内唯一；`ratedLoadKg` 为非负有限数值，`bulkWaterCarrier` 为布尔值，车型只作字典分类，不推导承运能力。当前承运归属的有效引用阻止其来源失效；修改归属必须由用户显式保存，不自动停用关联对象。

新业务只采用 AUX stable ID 与服务端冻结的 typed snapshot。既有交易快照与精确引用保持原解释，不回查 current；WHS/VEH/FAC 编码及计数不复用历史编号。

## 4. 数据与引用

`aux_objects` 是 AUX 唯一事实表；`data` 保存严格白名单校验的 typed JSON 对象。AUX 不向中央 Approval 注册实体，不写 `approval_entries`、`approval_events` 或版本 payload。

BOB、VOU 和 ACC 在同一 PostgreSQL 事务中按 `(entity, aux_id)` 解析 current AUX。新选择或主动重选必须锁定 stable object、核对 entity 并要求 `enabled=true`；已有保存快照不再解析 AUX，只保留 stable ID 和已采用的 typed 值。对象不存在、entity 不一致或已停用时拒绝，不得从历史表、旧 entry 或其他实体回退。

AUX current 修改不会覆盖既有交易快照。结算方式在客户或供应商显式选择时解析，收款方式在客户或销售订单显式选择时解析；引用方按 3.3 和 3.4 节保存自足快照，后续提交、批准和制单不递归解析来源 current。客户结算快照保存销售加价，供应商结算快照不保存销售加价；委托配制制造费等采购加价由对应专门采购单据维护，不进入 AUX 或供应商主数据。

### 4.1 字段采用分类

每个 AUX 字段只能属于以下一种采用方式；禁止由读取方临时决定是否回查 current。

| AUX 对象                                  | 业务解释字段                                                                                         | 采用边界                                                                                       | 后续改动对既有业务                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| operating-entity                          | stable ID、code、法定名称、简称、税号、地址、联系方式和开票资料                                      | BOB 引用按其字段保存编码名称；VOU 与 ACC 期初票据保存完整 typed snapshot                       | 已有事实不回查 current，不重解释历史           |
| employee                                  | stable ID、code、身份、姓名、联系方式及任职资料                                                      | AUX/BOB 负责人及归属引用保存编码姓名；VOU 与 ACC 期初票据保存完整 typed snapshot               | 不改写已有经办、归属及交易快照                 |
| product-category                          | stable ID、code、name、parentId                                                                      | BOB product snapshot                                                                           | 不重解释；层级仅影响新选择与当前分类浏览       |
| product-type                              | stable ID、code、name、behaviorProfile                                                               | BOB product snapshot，VOU 再采用该产品 snapshot                                                | 不重解释产品行为、库存或生产                   |
| employee-category / department / position | stable ID、code、name、parentId                                                                      | AUX employee snapshot                                                                          | 不改写既有雇佣或交易人员快照                   |
| settlement-method                         | stable ID、code、name、termCode、ruleType、monthOffset、dayOfMonth、dayOffset、defaultSalesSurcharge | BOB customer/supplier snapshot；订单复制最终结算事实                                           | 不重算到期日、金额或加价                       |
| payment-method                            | stable ID、code、name、defaultSalesSurcharge                                                         | BOB Customer Version 的客户子单位 snapshot；销售订单保存最终方式与加价                         | 不重算既有订单金额                             |
| measurement-unit                          | stable ID、code、name、symbol、quantityScale                                                         | BOB product unit/formula snapshot；VOU 采用产品 snapshot                                       | 不改变历史数量精度、换算、库存或展示           |
| dictionary-type / dictionary-item         | stable type、item code 与采用时名称                                                                  | 当前只作无业务规则的选择与展示；进入正式 BOB/VOU 字段时由所属 typed snapshot 保存              | 排序与说明从不重解释业务；名称不改写已保存快照 |
| income-expense-type                       | stable ID、code、name、direction、parentId                                                           | 正式收支分类接入 VOU 时由 VOU line typed snapshot 保存；当前未接入的页面不得用自由字段伪装引用 | 已有单据分类、方向与归集不回查 current         |
| asset-category                            | stable ID、code、name、defaultUsefulLifeMonths、defaultResidualRate                                  | VOU asset-acquisition line 与批准后资产台账 snapshot                                           | 不重算既有折旧参数                             |

`description` 和页面排序不是业务计算输入；读取 current AUX 可用于管理页面展示，但不得覆盖 BOB/VOU 已保存的名称和业务参数。新 BOB/VOU 选择只接受当前启用的 stable object；来源随后停用时，已保存的精确 snapshot 继续可读和可执行。

## 资料候选

普通资料通过所属实体 GET options 加载，支持关键词、分页和历史筛选。新增候选只含启用资料，历史关联筛选保留停用资料；辅助读取不要求管理动作权限。共享 reference 资源删除。
