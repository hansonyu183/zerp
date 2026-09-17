# BOB 业务对象领域

## 1. 文档目的

本文定义 ZERP **BOB（Business Object）** 领域的业务模型、数据约束和事务边界。客户、产品、Supplier、Other Unit 与 Sales Partner 由 DCL 维护身份、内容和 Submission，BOB 提供正式资料、对象历史与独立启停。Customer 是唯一客户业务和核算对象。HTTP 路径和数据结构由可执行 Hono/Zod 路由生成。

BOB 使用固定领域标识 `bob`。本文记录 OpenAPI 无法独立表达的 highest-approved typed query、Submission、版本、独立启停、引用和业务不变量；Customer、Product、Supplier、Other Unit 与 Sales Partner 的 stable subject、business code 和 typed snapshot 由 DCL 拥有，版本头、状态和 Submission revision 由中央 Approval 拥有。

当前对外实体标识、字段、查询与引用协议由 `apps/api/` 的可执行 Hono/Zod 路由生成；本文不维护其副本。数据库内部名称可以使用 `fund_account`，对外 wire value 以生成契约为准。

## 2. 领域职责与边界

BOB 负责：

- 读取 DCL stable subject 与 typed snapshot，提供当前正式资料、对象历史和独立启停；
- 为客户、供应商、其他单位和销售合作方等强类型业务档案定义业务规则；
- 只允许新的业务引用当前启用资料，同时继续校验已有业务保存的精确 Approval Entry；
- 为其他领域提供 stable ID、当前来源和业务发生时所需的类型化快照。

BOB 不负责：

- 销售、采购、库存、资金收付等交易流程；
- Approval 生命周期、版本号、Submission revision、审批事件或 current-version pointer；
- 修改已发生业务记录中的历史引用；
- 替交易领域决定需要保存哪些业务快照；
- 绕过 APP 领域执行身份认证和 API 权限判断。

Customer、Supplier、Other Unit 和 Sales Partner 是相互独立的强类型业务档案。客户与供应商保存业务名称和业务属性，法定与开票内容通过 AUX 税务信息关联；Other Unit 与 Sales Partner 保持各自身份规则。同一现实对象可分别建档，不因共享税号合并业务身份。

五类档案身份、编码和类型化内容由 [DCL](dcl.md) 维护；本文保留其业务字段与正式采用不变量，DCL 在提交及审批事务执行这些规则。BOB 直接查询 DCL 最高已批准版本，不复制 current payload；其独立 enabled/object revision 不属于版本内容。

BOB 列表只返回当前正式资料、stable ID、编码、`sourceApprovalEntryId`、`sourceVersionNo` 与实体所需最小字段，不返回 `latestApproved`、`openVersion`、Approval status 或候选摘要。`sourceApprovalEntryId` 与 `sourceVersionNo` 直接来自同一 highest APPROVED DCL Approval Entry，仅用于展示和来源追溯。详情同样不接受历史 entry 参数。

Other Unit 与 Sales Partner 的法定识别号按各自档案类型与规范化值唯一；客户与供应商不按税号占用身份。名称、电话、邮箱和地址不是唯一键。五类档案保持独立启停，历史引用不变。

BOB 为 Customer、Product、Supplier、Other Unit 与 Sales Partner 提供 current `query|get|options`、对象历史及独立启停；维护、待办和审批使用 DCL 精确路径。Party、Party 权限、Party 页面、关系卡片、关系 root、影响预览和合并均不存在。

服务类业务档案的用户名称固定为“其他单位”，实体与路径使用 `other-unit`；它的 current、Submission、版本、维护和启停 HTTP 边界均为 `/bob/other-unit/*`。

BOB 不建立独立服务项目主数据、服务目录或 `/bob/service` 页面。服务内容由 VOU 服务合同保存，实际履约和验收由对应单据保存。

销售合作业务档案的用户名称固定为“销售合作方”，实体与路径使用 `sales-partner`。BOB 页面同时管理外部兼职销售和渠道商能力。

供应商与其他单位不按 ACC 往来科目区分，而按履约流程区分：Supplier 参与采购订单和仓库收货，Other Unit 参与服务合同和履约验收。

外部兼职销售和渠道拓客使用 Sales Partner，不并入 Employee 或 Other Unit。提交和批准必须至少具有 EXTERNAL_PART_TIME 或 CHANNEL_PARTNER 能力；客户选择主要业务归属时验证明确能力与有效性，不检查自归属。

Customer 直接持有付款识别、销售业务属性和逐币种信用额度，是唯一客户核算对象，全部业务直接选择客户。

经营主体与员工的维护、current 查询及新引用来源统一归 [AUX](aux.md#39-经营主体与员工)。BOB 不再注册这两个实体的查询或详情入口。每个我方资金账户必须且只能属于一个当前可用经营主体，一个经营主体可以拥有多个资金账户。

仓库、资金账户和车辆的维护、current 查询与新采用统一归 [AUX](aux.md#310-仓库资金账户与车辆)，BOB 不注册这三个实体的入口。

客户直接维护业务名称、联系人、电话、邮箱、业务地址、客户类型、结算、收款、运输、定价、信用额度、业务归属、内部提醒、默认订单备注和附件，并保留汇款识别资料与默认经营主体。默认值跨经营主体共用；每张交易保存实际采用值。法定与开票内容归 AUX 税务信息。

客户不维护客户—产品专属配置、客户包装偏好或默认配方对象。新销售订单的交付偏好和定制成品配方由 VOU 从同一客户、同一产品最近一张合格销售订单解析。

客户与供应商的税务关联由 DCL 审批；历史档案保留当时关联快照，发票采用 AUX 当前启用资料并冻结自身内容。

### 2.1 业务字段

BOB 实体使用类型化版本明细，不使用无约束 JSONB 保存正式业务数据。客户易变的定价策略是唯一例外：以本节严格定义、后端类型化校验的 `pricingPolicy` JSONB 值对象随客户版本保存；它不是任意扩展字段。完整 wire 字段以 Hono 生成契约为准。

客户保存一个当前启用经营主体作为新单据默认值，但不据此限制交易范围。每张销售单据必须明确选择当时有效的经营主体并保存其 AUX stable ID、编码、名称、税号、地址和电话快照；默认值及经营主体后续变化都不改写已有单据。

客户类型和车辆类型都由 AUX 字典项提供。客户冻结客户类型 stable ID、编码与名称快照；车辆同样冻结所选车辆类型快照。原“经销商客户”不再作为客户类型；渠道能力由独立 Sales Partner 档案表达。Supplier 不维护 `supplierType`，物流服务使用 Other Unit 表达。

销售订单保存客户类型编码和名称快照，供居间、业绩及后续明确采用它的版本化脚本读取；当前自动定价算法不使用客户类型。实际公式及结果验证属于对应 VOU 脚本版本，字典项本身不保存价格、品牌、提成或业绩规则。

客户类型字典项后续停用不追溯禁用或阻断已批准的客户，最新已批准客户版本仍可用于新销售业务。新建客户或提交、审核客户开放版本时，客户类型 stable ID 必须重新解析为当时启用的 AUX current 对象；开放版本复制了已经停用的类型时，必须先改选当前可用类型。

产品版本选择一个 AUX 产品类型。产品类型可以按业务名称扩展，但每个类型必须绑定一个系统内置行为模板；当前模板为原材料、自制成品、定制成品和包装物。模板只承载系统需要执行的封闭业务规则，产品类型不保存任意行为开关，领域逻辑也不得根据产品类型对象 ID 或名称分支。每个产品具有一个不可管理、无名称、无符号、无对象 ID 的抽象基准单位；它是该产品所有历史和当前数量可以直接汇总的稳定尺度，不是产品版本字段，也不随产品类型或行为模板变化。库存台账和配方计算只保存或消费该尺度上的基准数量，不保存基准单位。

产品类型是普通版本字段。创建首版草稿或从 latest approved 产品编辑出的候选版本都可以改选另一当前启用的产品类型；跨行为模板改选时，调用方必须明确确认并删除不适用于新模板的固定配方、默认包装规格或包装物字段，允许候选草稿暂时不完整。提交和审核只按候选版本最终选择的行为模板校验，候选批准前不影响旧 latest approved 产品和已有 VOU。

每个产品版本独立维护默认录入单位、计价单位，以及一项或多项单位换算。每项换算引用并冻结一个 AUX 计量单位；单位快照 fixedFactor 非空时采用该固定系数，产品 factor 必须为 null；fixedFactor 为空时产品 factor 必须为正的定点换算系数。有效系数按“录入数量 × 换算系数”向前端给出建议基准数量；一个单位在同一产品版本中只能有一项换算。产品提交和审核时，默认录入单位、计价单位以及页面允许选择的其他录入单位都必须存在于该版本的换算项中。换算只服务产品页面和制单页面录入，不是产品数量事实，不要求后端按它计算或校验基准数量，也不得被配方、履约、库存、成本或历史重算使用。

产品及配方的可见单位录入数量统一最多两位小数，按实际十进制值判断，存储补零不增加精度；超出直接拒绝。基本数量是调用方已经确认的事实，保持现有精度；例如 1.23 个系数为 0.0001 的单位建议基本数量 0.000123，确认后原值保存。默认包装规格和每容器基本数量属于包装换算系数，不按录入数量的两位规则截断。

历史产品与 Submission 的读取、审批和反审批保持原数量。复制或重新提交产品形成新 Submission 时，原始录入数量须满足当前两位规则；界面保留原值并明确提示重新确认，不自动舍入。旧固定配方被新订单采用时，服务端核对原配方事实后可以原样保留历史精度；修改配方数量则按新录入规则校验。

产品计量配置与产品类型正交；交易、配方、履约和库存共同使用调用方已经确认的基准数量，不按原材料、自制成品、定制成品或包装物分支解释录入值。普通商品仍按 kg 定价，包装物按自身计价单位定价并可标记为可回收。

每个非包装产品版本必须直接保存一个大于零的 `defaultPackagingSpec` 定点数，表示一标准包装件对应的基准数量。它是产品版本字段，不是独立对象、独立版本、关联引用或附表记录，也不维护产品交付规格集合。产品版本保存、提交、审核、复制和冻结时整体处理该字段。

默认包装规格不随产品的默认录入单位变化，只作为桶装订单标准计件数的折算口径，不描述客户实际使用的大桶、小桶或散水。实际交付规格属于 VOU 销售订单行；散水的订单选择、槽车要求和每 1000 基准数量一标准件规则由 VOU 保存和执行。

自制成品必须维护版本化固定配方。固定配方由基准产量数量快照和一至两百行原料数量快照组成，
每行只能引用一个已批准的原材料，原料不可重复且基准数量必须大于零。配方只把无单位基准数量作为计算事实；各数量必须同时保存录入数量和单位作为审计快照，但换算系数和建议换算结果不进入配方。配方不依赖产品类型解释数量，也不保存基准单位。配方随产品
版本复制和批准；创建新的产品候选版本时，按每个原料对象自动解析并替换为其 latest approved 版本，同时保持已经确认的基准用量不变。新销售订单复制配方时同样按原料对象解析 latest approved 版本，但保持基准
产量数量快照、原料对象和用量数量快照不变。原料新版本不影响旧产品版本或已经生成的销售订单
配方快照。原材料、定制成品和包装物不维护产品固定配方。

产品临时表单允许暂缺默认包装规格、单位配置和自制成品固定配方；页面编辑只校验已经填写的数据是否合法，不要求草稿完整。提交和审核必须通过同一套完整性规则，保证 `APPROVED` 产品满足其产品类型、默认包装规格、单位换算和固定配方约束。产品页面在提交前通过统一的前端检查模块执行对应检查并给出字段级提示，后端仍重复执行同一业务不变量，前端检查结果不能代替后端校验。

客户和供应商都通过 `settlementMethodId` 选择当前启用的结算方式辅助对象。选择时必须把 AUX stable ID 以及交易使用的结算方式名称、术语和到期计算参数复制进引用方版本，形成不可变的类型化快照。已有历史版本和单据快照不会随来源变更被改写；Customer 的 DCL Submission 与 Supplier 的 DCL Submission 配置了结算方式时，提交和审核只校验所存快照的内部完整与参数组合，不回查 AUX current。客户快照另保存销售加价，供应商采购不使用该销售加价。客户和供应商即使提交、审核或批准也可以不维护结算方式；缺失时整组快照为空且 offset 为 0，配置时则必须完整且内部一致。没有明确账期的正式客户或供应商不能用于创建销售订单或采购订单，由 VOU 返回固定 blocker。委托配制制造费等采购加价不属于供应商主数据，由对应专门采购单据维护并保存自身事实。交易单据的到期日和加价规则见 VOU 文档。

Other Unit 可以通过 `settlementMethodId` 保存服务合同使用的可选结算默认快照。它不维护服务范围或默认内部经办员工；每份服务合同自行选择 Employee 并保存快照。

仓库的库存地点、负责人及停用 blocker 规则见 [AUX](aux.md#310-仓库资金账户与车辆)。

客户自动定价基础数据聚合为一个 `pricingPolicy` 值对象，其严格持久化结构如下；不得出现未声明属性：

```json
{
  "defaultPremiumUnitPrice": "0.00",
  "defaultDiscountUnitPrice": "0.00",
  "costItems": [],
  "thirdPartyIntermediaryFixedUnitCost": "0.00",
  "thirdPartyIntermediaryVariableUnitCost": "0.00"
}
```

`costItems` 保存多项具名销售成本组成。成本行是客户版本内部的值，不具有独立编码、启停、审核或生命周期，也不能跨客户复用；同一策略内规范化后的名称必须唯一。每行保存 `name`、`calculationBasis` 以及一个大于零的两位小数金额：`UNIT_PRICE`（单位型，金额跟随商品计价单位）必须且只能保存 `unitPrice`，`ORDER_AMOUNT`（整单型，每张订单固定发生）必须且只能保存 `orderAmount`。零金额行无效，没有该项成本时删除对应行。不使用通用 `value`、同时填两个金额或一个“其他价格”字段混装。成本行只保存客户默认的名称、口径和值，不保存订单分摊结果；VOU 对多明细订单的整单型成本按明细基础金额比例分摊。成本列表不保存 `sortOrder`，读取和页面展示统一按规范化名称稳定升序。

第三方居间成本与客户优惠、客户默认溢价及销售人员收益分开。`pricingPolicy.thirdPartyIntermediaryFixedUnitCost` 与 `pricingPolicy.thirdPartyIntermediaryVariableUnitCost` 是独立持久化的顶层字段。两项都是非空、非负、两位小数的人民币单位值并默认 `0.00`，不组成复合对象、可以同时存在，也不进入普通 `costItems`；固定项按 kg 计算，浮动项如何从业务差价形成留到后续算法讨论。客户价格资料不要求绑定具名第三方收款对象。

每个客户同一时间只能维护一个 primarySalesAttribution。内部员工采用 AUX current，外部兼职和渠道商采用具备对应能力的启用 Sales Partner 精确版本，保存身份、编码和名称快照，不做自归属检查。

客户版本保存默认运输政策：`defaultTransportMethodCode`、`defaultTransportMethodName` 和 `defaultTransportSurcharge`。运输方式和客户约定运输加价是两个独立事实；加价为非负、最多两位小数的元/kg 定点字符串。客户草稿可以暂缺，提交和审核时必须完整。新销售订单默认带入，允许按单修改，并保存最终运输方式和加价快照。

客户通过 `paymentMethodId` 选择当前启用的 AUX 收款方式。客户版本直接保存 `paymentMethodId`、`paymentMethodCode`、`paymentMethodName` 和 `paymentMethodSalesSurcharge`，不保存 AUX Approval Entry。收款方式回答“使用什么付款媒介”，结算方式回答“何时应付款”；两组快照独立保存、独立影响销售价格，不得合并。客户草稿可以暂缺收款方式，提交和审核时必须保证自身快照完整，不因 AUX current 后续改变而重解释。

客户价格政策把偏离基础报价的金额严格分为销售成本组成、销售溢价和销售优惠。`pricingPolicy.defaultPremiumUnitPrice` 和 `pricingPolicy.defaultDiscountUnitPrice` 是策略内两个互相独立的顶层字段；两者均为非负、最多两位小数的单位价格并默认 `0.00`，允许同时为正数。两项都进入自动价格并由新销售订单分别带入：前者自动增加默认溢价，后者自动给出默认优惠。`defaultDiscountUnitPrice` 同时就是该客户免批优惠单价，不另设审批阈值字段；订单最终优惠单价超过它时必须特殊批准，等于时不触发。整单优惠总额、成本和溢价均不触发该优惠审批。成本组成必须以具名来源单独保存，不进入溢价或优惠字段。

当前自动定价基础数据统一使用人民币，不在客户版本的成本、溢价、优惠、运输加价或第三方居间字段上维护币种，也不提供外币换算。现有交易币种和多币种信用额度不据此扩展客户自动定价能力；将来若出现真实外币定价需求，必须重新确定领域规则，而不是在当前字段中预留换算或回退路径。

客户自动定价中的全部单位价格、整单金额和第三方居间单位值统一保存两位小数。`pricingPolicy` 的四个顶层数值键均必填并默认 `0.00`，`costItems` 必填并默认空数组；任何键均不用 `null` 表示无值。

Customer Version 使用 `pricingPolicy` 保存上述完整封闭值对象。OpenAPI 和后端拒绝未知键、缺失键、`null`、非法金额、无效成本口径、金额字段组合、零金额成本和重复规范化名称；不得把原始 JSON 映射直接传入领域服务。Customer candidate 复制时完整复制完整策略，历史版本保留自己的不可变快照。

当前 `pricingPolicy` 不保存 `schemaVersion`；客户版本本身已经提供历史边界，只有出现已确认的结构变化时才调整封闭契约并明确处理已有版本，不预设规则版本层。首版不为 `pricing_policy` 建 GIN 索引、表达式索引或金额生成列，客户 `query` 也不按定价策略筛选；完整策略只在 `get`、版本详情和实际消费方读取。出现真实筛选或统计需求前不得增加投机性索引。

客户版本历史和候选对比必须先按封闭类型解析 `pricingPolicy`，再分别展示默认溢价、默认优惠、固定第三方居间、浮动第三方居间及按规范化名称匹配的具名成本新增、删除、口径变化和金额变化。页面和审计接口不得向业务用户返回原始 JSON 对比文本，也不得只显示“定价策略已修改”而隐藏具体变化。

客户以 `creditLimits` 保存按交易币种区分的信用额度，同一币种只能一条。实时占用由 ACC 按客户 stable ID 和原币计算，不跨客户共享额度。销售订单超过对应额度时的审批和快照规则不变。

客户使用 `internalReminder` 保存只供内部查看的选客提示，使用 `defaultSalesOrderRemark` 保存新销售订单默认备注；两者随 Customer Version 整体保存。内部提醒不复制进单据，默认订单备注只在创建订单时复制。

应付款日期只按客户结算快照和实际业务日期计算。销售订单的打印数期从同一客户上一张合格订单取得默认值，保存后成为订单事实。

客户附件在同一个 Customer 本地 Draft 中编辑，并随 submit 创建的同一 Submission 冻结和审批。已持久化 Submission 与历史版本只读。附件类别保存 AUX stable ID、编码和名称快照，来源后续变化不改写历史。

服务相关附件分两层保存：Other Unit 的身份、税务及合作资格资料归其 DCL typed Submission snapshot；正式合同、补充协议、履约证据和验收材料归对应 VOU 单据。两层不得复制形成第二份事实。

### 2.2 客户与供应商结算方式快照

结算方式辅助对象及固定规则由 [AUX 领域](aux.md#33-结算方式)维护。客户保存所选结算方式的 stable ID、名称、术语、到期参数和销售加价快照；Supplier 保存相同基础快照但不保存客户销售加价。

上述字段作为一组由后端原子复制和校验的结算快照，客户端不能分别拼装。没有配置时，客户、Supplier 或 Other Unit 的整组字段为空；显式重新选择时才整体替换。AUX 来源后续变化不追溯改变既有版本。

客户的 `primarySalesAttribution` 必填并采用当前 AUX Employee 快照或 Sales Partner 精确版本。Supplier 的 `defaultPurchaserEmployeeId` 可引用任意当前启用 Employee，不附加任职经营主体或岗位限制，并保存精确快照。

Customer 通过 submit-new/submit-change 原子提交全部业务内容，校验正式版本基线与唯一开放提交件。客户启停不进入版本，不设子单位或额外维护能力。

`code` 由服务端按对象实体分配，格式固定为 `PPP-NNNN`：`PPP` 是全局唯一的三位对象前缀，
`NNNN` 是该实体永久递增且不复用的四位流水号。达到 `9999` 后拒绝继续创建。前缀固定为：

```text
customer CUS                 supplier SUP                 other-unit OTU
sales-partner SLP
product PRD
```

AUX 经营主体、员工、仓库、车辆与资金账户的编码及字段约束见 [AUX](aux.md)。本域剩余档案的字段校验以各自可执行契约为准：Customer、Product、Supplier、Other Unit 与 Sales Partner 维护均使用 DCL，正式采用使用 BOB。

Other Unit 与 Sales Partner 的非空法定识别号分别在各自名录内唯一，客户与供应商不占用法定识别号。

DCL 不实现第二套审核、版本或归档流程；其 Submission、版本、操作者与审计时间由 DCL 领域事务协调中央 Approval 与 Version 组件生成，客户端不得伪造。

### 2.3 Stable identity 与草稿删除边界

DCL 不物理删除 stable subject；只删除开放 Submission，保留稳定身份和业务编码，编码不复用。

### 2.4 车辆承运归属

外部承运方使用 Other Unit，不属于 Supplier，也不建立独立物流档案类型。具体合同、送货单或承运业务对该档案的引用表达其物流用途。

车辆承运归属、车型与散水承运能力的唯一规则见 [AUX](aux.md#310-仓库资金账户与车辆)。历史交易保留采用时快照。

运输任务和履约事实由 VOU 保存。

### 2.5 辅助对象与业务对象引用

`productTypeId`、`categoryId`、`employeeCategoryId`、`departmentId` 和 `positionId` 引用对应 AUX 对象；`managerEmployeeId` 和 Supplier 的 `defaultPurchaserEmployeeId` 引用 Employee current。Customer 只有默认经营主体且不维护白名单；Supplier、Other Unit 与 Sales Partner 保存适用经营主体集合和默认值；Employee 保存一个任职经营主体但不形成单据选择限制。已有正式版本和单据继续使用自身快照。

产品分类只允许用于产品，不再为客户、供应商、员工、服务、仓库、车辆、资金账户等对象提供含义宽泛的通用分类。AUX 对象停用或修改后不会追溯改变已经保存的申报版本；只有用户新选择或更换 AUX 对象时才校验当时的 current 状态，后续审核只校验引用方快照完整性。车辆与承运归属对象的严格递归有效性规则仍按 2.4 节执行。

## 3. 聚合模型

### 3.1 Customer、Product、Supplier、Other Unit 与 Sales Partner stable subject

五类已迁档案使用以下所有权结构：

```text
DCL Subject (stable ID, entity, business code, created metadata)
  └── Approval Entry 1..n (version, status, revision, approval metadata)
        ├── DCL Typed Snapshot 1
        └── Approval Event 1..n

BOB Typed Query
  └── DCL Subject + BOB enabled/object revision + highest APPROVED Entry + DCL Snapshot
```

BOB 对象的 `enabled` 与 object revision 只描述对象当前可用性，不进入 Submission snapshot，Approval Entry 不保存它们；Approval Entry 是唯一版本头，typed snapshot 是唯一业务内容 payload。Customer typed snapshot 直接持有全部客户业务属性。交易只引用明确的强类型档案，客户交易使用 `customerId + customerApprovalEntryId`；Party 不存在。

`bob_legacy_enablement_evidence(approval_entry_id, enabled)` 保留提交时的启用审计证据，不参与运行时选择。<!-- docs-check: legacy-exception=historical-read ref=ADR-0055 --> 新 Submission 不含 enabled，当前读取与新引用只使用 BOB 对象的单一 enabled 事实。

### 3.2 Submission、版本与审计

DCL 使用公共 Approval 与 Version 组件，不建立第二 Approval Entry、版本头、current pointer 或审批事件。`query/get/options` 必须以 entity 和 subject 双重约束选择 highest `APPROVED` entry，再连接对应 typed snapshot；`sourceApprovalEntryId` 与 `sourceVersionNo` 直接来自该 entry。`submission-query/submission-get` 只读取持久化 Submission，`versions` 只读取版本历史；声明生命周期审计只写中央 `approval_events`。Approval、Version 和 DCL Domain Plan 在同一外层事务中落库，任一步失败全部回滚。

业务字段尚未确定前，不应仅为追求通用性把全部正式字段长期存入无约束 JSONB。客户 `pricingPolicy` 是因定价规则结构易变而明确限定的封闭值对象例外，不得扩展为通用客户属性包。

### 3.3 产品版本与独立启停

产品使用公共 Approval 与 Version，BOB 持有 stable ID、PRD 编码和完整产品版本。对象 enabled 与 revision 独立于版本，批准和反批准不得覆盖 enabled。正式读取先选最高已批准版本再应用过滤；停用不回退历史版本。提交件读取与完整版本历史分别提供独立动作。

产品采用的 AUX typed snapshot 保存单位 fixedFactor；批准只校验快照完整性。配方原料保存精确 BOB Approval Entry，新提交和批准验证其为当前可用最高正式版本。条码在各对象最高正式版本与开放提交之间大小写不敏感唯一。正式业务或产品配方精确引用阻止反批准，失败与审批、版本和审计同事务回滚。

产品 ID、编码、全部 Approval Entry、审批事件和已保存业务快照保持不变；历史 enabled 留为审计证据。交易、配方和库存权威基准数量不重算。页面临时表单只在本页面内存保存，关闭即销毁，提交未知结果核实后才能重试。

## 4. 当前有效资料读取

Customer、Product、Supplier、Other Unit 与 Sales Partner 的 BOB current 读取与 Submission/版本读取严格分离：

- V1 批准前，BOB typed query 无结果；
- V1 批准后，BOB typed query 读取 V1；
- 后续候选未批准时继续读取上一批准版本；
- 新版本批准后，查询自然读取新的 highest APPROVED entry；
- latest approved 反批准后，查询自然回落到上一批准版本，首版反批准后无结果；
- approve/unapprove 只重新选择 highest approved typed snapshot，不覆盖对象 `enabled` 或 object revision。

BOB `query/get/options` 不接受 lifecycle status 或历史 entry 作为读取模式；`submission-query/submission-get` 归 DCL；BOB `versions` 和历史详情按对象历史权限读取，验证 entity、subject 与 Entry 归属，历史详情只读且不要求 DCL 权限。`enable/disable` 只改变对象当前可用性，不创建候选、版本或 Approval event；不存在 Party 或档案合并动作。

## 5. 领域动作

公开动作及路径由 Hono route metadata 生成。BOB 提供正式 query/get、对象历史与启停，所属实体 GET options 不登记独立动作权限；DCL 独占提交件、维护、审批及开放删除。

五类档案按各自真实路径授权，不因现实主体相同而授权另一类型。历史详情复用 versions 权限，启停不从提交或审批推导。对象详情展示完整版本状态、差异、只读快照和附件；未批准记录只用于历史解释，不作为正式资料。

## 6. 动作语义与约束

### 6.1 查询

查询请求、筛选、排序和分页结构以 Hono 生成契约为准。各实体必须在后端定义允许的筛选、排序和关键词字段白名单；客户端字段名和排序方向不能直接拼接进 SQL。资金账号不能进入关键词搜索。

BOB `query` 永远只返回 current 行；DCL Submission 状态不进入筛选或响应，候选待审也不改变当前可读结果。

客户、供应商、其他单位和销售合作方的 `query` 必须各自在一个只读 `REPEATABLE READ` 事务中完成，直接连接所属 stable subject、highest `APPROVED` Approval Entry 和对应 typed snapshot，不连接 Party 或关系 root。查询 SQL 次数不得随页大小增长。

资金账号只在 BOB current `get` 与 BOB 授权提交及历史详情中返回完整值；BOB `query` 摘要和 reference resolver 必须清空 `accountNumber`，也不得把账号纳入关键字搜索。

### 6.2 查看与引用

BOB `get` 只接受稳定对象 ID，并返回 current 类型化详情、`sourceApprovalEntryId` 与 `sourceVersionNo`；current 不存在时返回稳定未找到错误。它不接受历史 `approvalEntryId`，也不返回 Approval metadata、开放候选、版本或审计。

BOB 所属实体 GET `options` 返回最小引用资料，支持关键词和分页；新增业务候选只含当前启用对象，历史筛选可包含停用对象。辅助读取只要求有效 Session，不要求被引用实体管理权限。新业务由内部 typed resolver 解析 current 来源；已有业务按自己保存的稳定对象 ID 与精确 Approval Entry 校验历史来源，BOB 对象历史详情额外验证 entity、subject 和 Entry 归属，并按 versions 授权，不能被精确引用读取替代。

### 6.3 写入与独立启停

五类档案的 Submission 只能由 DCL 的 `submit-new` 或 `submit-change` 创建，开放 Submission 只能由 `delete` 删除；不注册 `create/save`、持久 Draft、`unsubmit`、路径别名或失败替代数据。`enable/disable` 需要独立 object revision，在外层事务内重新授权、锁定、CAS、检查该对象的 blocker 并审计；同状态或陈旧 revision 拒绝，失败不留部分事实。批准、反批准和版本选择不能改变 enabled；没有 approved 版本的对象即使启用也不可被新业务引用。

## 7. 并发与事务规则

### 7.1 乐观并发

- `submit-new`、`submit-change`、Approval lifecycle 与开放 Submission delete 由 Approval revision 保护；`enable/disable` 只接收 object revision，二者不互相替代；
- DCL typed identity reserve/delete 必须锁定 stable subject，并由外层 Approval/Version Plan 保护整笔动作；
- 来源、identity 或 Approval 状态已变化时返回稳定冲突，不能自动重放或退回旧来源。

WFL 流程定义的独立运行 revision 与启停规则由 [WFL](wfl.md#2-定义与-approval-version) 拥有。

### 7.2 数据库锁

DCL 创建候选、批准、反批准、开放 Submission 删除和启停必须在事务内按固定顺序锁定 DCL stable subject、Approval Entry 与相关引用。Approval 与 Version 组件不提交该外层事务。Customer 在 DCL 同一事务中保护自身 stable ID 与税务关联。

### 7.3 幂等边界

BOB HTTP 读接口天然幂等。Submission 写入只依赖自身事务提交或回滚，不建立 current 写入、事件重放或补偿写入；重复提交意图按提交幂等规则核实，未知结果不得自动重放。

## 8. 有效引用规则

交易领域创建新记录时，必须同时保存：

- 强类型业务档案 stable ID；
- 实际采用的 `approvalEntryId`；
- 交易领域需要的名称、编码、身份、税务及业务快照。

客户销售和应收引用 `customerId + customerApprovalEntryId`；采购和应付引用 Supplier；员工业务引用 Employee；普通服务引用 Other Unit；外部兼职与渠道收益引用 Sales Partner。不得保存 Party ID 或用自由文本解释对象类型。

BOB 提供两个不得混用的内部领域能力。`ResolveLatestApprovedReference(entity, objectId)` 用于新建、新选择或主动重选，只接受当前 latest `APPROVED`。`ValidateApprovedSnapshotReference(entity, objectId, approvalEntryId)` 用于已有交易保存未修改引用，只确认 entry 属于该对象、曾正式批准且快照身份一致；它不要求 entry 仍是 latest。两者都必须在交易自身数据库事务中调用，并确认：

1. 对象和 Approval entry 存在且实体匹配；
2. latest 解析的 entry 是该 subject 中版本号最大的 `APPROVED` entry；snapshot 校验的 entry 具有正式批准元数据且身份不可伪造；
3. 对象当前启用；
4. 当前操作者满足必要的数据范围规则。

VOU 已保存的 `objectId + approvalEntryId` 快照在对象产生新批准版本后仍可继续保存；若用户主动重选同一对象，则必须重新解析 latest。候选、最大创建版本和伪造 entry 永远不得作为正式快照。

新采用车辆通过 AUX current 并在同一事务校验承运归属有效性，保存 stable ID 与 typed snapshot。历史交易只读取已保存快照。

AUX 产品分类、部门、岗位和结算方式只在选择或更换时校验 current 并复制关键值。经营主体、负责人、内部业务归属和默认采购员只在采用时校验 AUX current 并保存快照；外部业务归属仍按 BOB Approval Entry 校验。Employee 的任职经营主体不限制跨经营主体选择；最终经营主体与资金账户仍必须相同。

引用候选在读取时有效不构成写入保证。为避免“校验后、交易写入前”发生编辑失效，交易事务应对对象行取得与 BOB 编辑更新互斥的共享锁，或采用经验证的等效数据库约束/串行化方案。

已经保存的历史业务引用不因后续批准、反批准或启停而失效、级联更新或删除。BOB 表禁止配置会破坏历史引用的级联删除。

## 9. 校验与唯一性

校验分为三层：

1. **传输校验**：JSON 类型、必填字段、长度、枚举和 ID 格式；
2. **实体校验**：各实体字段组合、精度、编码规则和条件必填；
3. **领域校验**：状态、提交人与审核人分离、唯一性、关联对象有效性和并发版本。

code 在同一实体的稳定对象间唯一；只有 Other Unit 与 Sales Partner 保持各自法定识别号唯一性，条码、VIN、资金账号和车牌的占用规则不变。

## 10. 权限与审计

- 所有接口先由 APP 中间件校验会话、CSRF 和完整 API 路径权限；
- 每类业务档案的 `query/get`、Submission、版本、审批与启停使用独立 BOB 精确权限，不被其他档案权限隐式包含；
- 查询和详情只返回页面与交易需要的字段，敏感身份资料继续按字段权限裁剪；
- BOB 读取权限不构成业务写入、待办、审批或启停资格；所有 BOB 档案的创建、维护、候选及审批使用 DCL 精确权限；
- 日志记录 `requestId`、实体、稳定对象 ID、来源 entry 与结果类别，不记录完整税号、账号、联系方式等敏感业务字段；
- 客户数据范围遵守 [APP 客户范围](app.md#部门角色与客户数据范围)，列表、单对象、历史、附件与辅助读取同时实施，防止通过 ID 绕过。

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

BOB 验收以 Customer、Product、Supplier、Other Unit 与 Sales Partner 的 current、Submission、版本、审批和独立启停公共边界为准。至少覆盖：

1. 每个 BOB entity 提供正式 query/get、versions 和启停；对应 DCL entity 提供 submission-query/submission-get、提交和生命周期；辅助候选提供所属实体 GET `options`；
2. query/get 只读取 current，Submission 与版本读取只走独立动作；
3. 每个 current 响应返回 `sourceApprovalEntryId` 与 `sourceVersionNo`，两者来自同一实体、subject 和 approved entry；
4. V1/V2 批准与反批准后，BOB typed query 分别自然出现、切换、回落或消失；候选待审期间仍读取上一批准版本；
5. Submission、Approval、Version、typed snapshot、对象启停、blocker 与审计的任一步失败都会整体回滚；
6. 新引用只选择 current enabled 对象，已有业务继续按精确 Approval Entry 校验历史来源；
7. enable/disable 不创建版本、不改变 Submission revision，批准或反批准不覆盖 enabled；
8. 旧 BOB 五类档案维护入口和权限不可达；DCL 持有完整历史，BOB 对象历史入口按 versions 授权；
9. 真实 PostgreSQL、HTTP 与 E2E 证明 current、来源版本、权限和临时表单边界同时成立。

## 13. 待决事项

- 员工与 APP 用户及组织的后续关联方式；
- 产品后续的价格、税率和多币种属性；
- 资金账户后续的账户类型、字段级加密和更细的数据可见范围；
- 是否需要多级审核及委托审核；
- 历史版本和审计记录的保留、归档和脱敏策略。

### 3.4 单层客户与税务关联

Customer 是唯一客户 Approval subject、销售引用和客户核算对象；DCL 分配 stable ID 与 CUS 编码。版本直接保存业务名称、电话、邮箱、业务地址、联系人、客户类型、结算、收款、运输政策、pricingPolicy、逐币种信用额度、主要业务归属、内部提醒、默认订单备注、汇款识别资料、默认经营主体和附件。客户整体 enabled 与 object revision 由 BOB 独立维护，批准、反批准和版本回落均不覆盖它。

客户与供应商不保存独立身份类型、法定名称、单一法定识别号或重复开票字段，不以单一税号占用业务身份。各自版本关联零至多条不重复 AUX 税务信息，不设默认项；多个客户或供应商可以共享同一条税务资料。新关联在 DCL 提交事务解析当前启用对象并冻结关联采用时内容，已有关联历史快照不被 AUX 更新覆盖。关联集合变更随档案审批；AUX 内容更新不要求档案重批。历史详情明确展示当时快照，不能标作最新税务资料。开票采用规则见 [VOU](vou.md#36-往来收款与往来付款)，税务维护规则见 [AUX](aux.md#311-税务信息)。

Customer 通过 submit-new/submit-change 原子提交完整业务内容与关联集合，锁内校验正式版本基线和唯一开放 Submission。不存在子单位身份、SUB 编码、子单位启停、隐式选择或 save-subunits 能力；删除该能力不扩大为客户维护或审批权限。销售、收付、票据、定价、信用、核算、期初、工作流与报表保存客户 stable ID 和精确 Customer Approval Entry。

主要业务归属为 INTERNAL_EMPLOYEE（内部员工）、EXTERNAL_PART_TIME（外部兼职）与 CHANNEL_PARTNER（渠道商）；前者采用 AUX 员工，后两者采用当前启用且具备对应能力的 Sales Partner 精确版本。不比较客户与合作方的法定身份或关联税号来禁止自归属。

附件随临时表单保留 Blob，提交时通过 DCL 暂存并在同一事务采用；失败及过期暂存清理由既有机制处理。正式附件按 BOB get 权限、历史附件按 BOB versions 权限、提交件附件按 DCL submission-get 权限读取，均校验 subject、Entry 和附件归属。附件内容损坏返回 customer_attachment_invalid_content。
