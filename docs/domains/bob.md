# BOB 业务对象领域

## 1. 文档目的

本文定义 ZERP **BOB（Business Object）** 领域的业务模型、数据约束和事务边界，覆盖经营主体、仓库、车辆、资金账户、产品、员工、客户、供应商、其他单位与销售合作方的当前有效只读业务资料。上述版本化档案由 DCL 管理；客户核算账户是 Customer Version 子项，不是独立 BOB/DCL 对象。HTTP 路径和数据结构以根目录 OpenAPI 为准。

BOB 使用固定领域标识 `bob`。本文只记录 OpenAPI 无法独立表达的 highest-approved typed query、引用和业务不变量；stable subject、business code、声明生命周期与 typed snapshot 由 DCL 拥有，版本头、状态和 revision 由中央 Approval 拥有。

当前对外实体标识、字段与路径见 [OpenAPI BOB Schema](../../contracts/openapi/schemas/bob.yaml)；本文不维护其副本。数据库内部名称可以使用 `fund_account`，对外 wire value 仍以 OpenAPI 为准。

## 2. 领域职责与边界

BOB 负责：

- 通过每个实体明确的 typed query 读取 DCL highest APPROVED 完整 snapshot；
- 为客户、供应商、员工、其他单位和销售合作方等强类型业务档案定义业务规则；
- 只允许新的业务引用当前启用资料，同时继续校验已有业务保存的精确 DCL Approval Entry；
- 为其他领域提供 stable ID、当前来源和业务发生时所需的类型化快照。

BOB 不负责：

- 销售、采购、库存、资金收付等交易流程；
- 创建、保存、提交、撤回、驳回、批准、反批准、删除、版本或审计等声明写入与 lifecycle HTTP API；
- 保存 stable identity、business code、当前资料副本、`bob` domain Approval entry、版本号、候选、审计事件或 current-version pointer；
- 修改已发生业务记录中的历史引用；
- 替交易领域决定需要保存哪些业务快照；
- 绕过 APP 领域执行身份认证和 API 权限判断。

Customer、Supplier、Employee、Other Unit 和 Sales Partner 是相互独立的强类型业务档案。每类档案都直接保存自己的 `PERSON|ORGANIZATION` 法律身份、名称、税号、强标识、联系资料和业务专属资料；同一现实个人或组织具有多种身份时分别建档、分别审批，不共享或同步资料。

全部业务对象的 stable subject、business code、声明创建、保存、启停候选、提交、撤回、驳回、批准、反批准、删除、版本与审计固定由 DCL 编排，不进入 BOB 写服务。BOB 只保留各实体 `query/get/reference`、业务校验与精确历史引用能力；批准或反批准不调用 BOB writer。新增实体字段或查询规则不得继续堆入一个要求理解全部 BOB 实体的万能查询或保存流程，也不得为了消除表面重复而把实体规则改造成运行时 metadata。

BOB 列表只返回当前正式资料、stable ID、编码、`sourceApprovalEntryId`、`sourceVersionNo` 与实体所需最小字段，不返回 `latestApproved`、`openVersion`、Approval status 或候选摘要。`sourceApprovalEntryId` 与 `sourceVersionNo` 直接来自同一 highest APPROVED DCL Approval Entry，仅用于展示和来源追溯，不成为 BOB 版本权威。产品单位换算和配方、员工雇佣资料均从该 entry 对应的完整 DCL snapshot 读取，并使用固定次数的 typed 查询；详情同样不接受历史 entry 参数。

个人证件号、统一社会信用代码和税号等强标识按“档案类型 + 标识类型 + 规范化值”唯一；跨档案类型不比较、不复用、不提示和不合并。名称、电话、邮箱和地址不是唯一键。误建档案没有合并动作；已有业务引用时只能建立下一候选停用，历史事实保持原稳定 ID、Approval Entry 和快照。

BOB 只提供每种业务档案的 current `query|get|reference`。创建、编辑、启停、审批、版本和审计统一进入对应 DCL 页面。Party、Party 权限、Party 页面、关系卡片、关系 root、影响预览和合并均不存在。

服务类业务档案的用户名称固定为“其他单位”，实体与路径使用 `other-unit`，维护路径为 `/dcl/other-unit`，`/bob/other-unit` 只提供 current 只读资料。

BOB 不建立独立服务项目主数据、服务目录或 `/bob/service` 页面。服务内容由 VOU 服务合同保存，实际履约和验收由对应单据保存。

销售合作业务档案的用户名称固定为“销售合作方”，实体与路径使用 `sales-partner`。页面同时管理外部兼职销售和渠道商能力。

供应商与其他单位不按 ACC 往来科目区分，而按履约流程区分：Supplier 参与采购订单和仓库收货，Other Unit 参与服务合同和履约验收。

外部兼职销售和渠道拓客使用 Sales Partner，不并入 Employee 或 Other Unit。草稿允许暂缺能力，提交和批准时必须在 `EXTERNAL_PART_TIME`、`CHANNEL_PARTNER` 中至少选择一种。客户核算账户的主要业务归属必须选择明确能力。Customer 与 Sales Partner 强标识相同时禁止自归属；缺少可比较强标识时不推测。

Customer 是付款识别、税务抬头和收款分摊根，并在同一版本中包含一个或多个客户核算账户。每个有效客户至少有一个有效账户和一个默认账户；账户没有独立审批、版本、页面或 current 对象。

`operating-entity`（经营主体）表示我方实际承担合同销售方、开票方和收款方责任的法人公司，不是商品品牌、客户类型或报表标签。DCL 拥有它的 stable ID、business code、强类型快照和候选编排，中央 Approval 拥有版本与审批事实；BOB 直接读取 highest APPROVED typed snapshot 并提供交易引用。`/bob/operating-entity` 是独立的当前正式档案只读入口，只使用 BOB `query/get`，不展示候选或生命周期控件；维护入口固定为 `/dcl/operating-entity`。完整规则见 [DCL 经营主体申报](dcl.md)。每个我方资金账户必须且只能属于一个当前可用经营主体，一个经营主体可以拥有多个资金账户。

`warehouse`（仓库）的 stable ID、business code、完整候选快照、启停申请和审批同样由 DCL 拥有；BOB 直接读取 highest APPROVED typed snapshot 并提供交易引用。`/dcl/warehouse` 是唯一维护入口，`/bob/warehouse` 是只使用 `query/get` 的独立当前有效资料入口，不显示候选、审批、版本或写动作。仓库仍是全局共享的最小物理库存地点，不绑定经营主体；负责人、地址、联系人和备注保持强类型字段。完整生命周期、读取和事务规则见 [DCL 仓库申报](dcl.md#31-仓库申报)。

法定身份、税务、开票抬头、开票地址、开票电话、开票开户行及账号、汇款识别档案、默认经营主体和身份税务附件属于 Customer。汇款识别档案以付款户名为必填识别值，并可保存付款银行和付款账号；它不形成核算余额或准入边界。账户名称、联系人、业务地址、客户类型、结算、收款、运输、定价、信用额度、业务归属、内部提醒、默认订单备注和业务附件属于客户核算账户。客户不维护经营主体白名单；任一有效经营主体都可用于销售单据。账户业务参数跨经营主体共用一套默认值，不建立覆盖层；交易保存实际经营主体和采用值快照。

客户核算账户不维护客户—产品专属配置、客户包装偏好或默认配方对象。新销售订单的交付偏好和定制成品配方由 VOU 从同一账户、同一产品最近一张合格销售订单解析。

客户税号通过完整 Customer candidate 新增、修改或清空。变更不重分类历史：开票义务只由销售签收批准时保存的 Customer Approval Entry 和税务快照决定，历史签收和退货沿用原事实。

### 2.1 业务字段

BOB 实体使用类型化版本明细，不使用无约束 JSONB 保存正式业务数据。客户易变的定价策略是唯一例外：以本节严格定义、后端类型化校验的 `pricingPolicy` JSONB 值对象随客户版本保存；它不是任意扩展字段。完整 wire 字段以 [OpenAPI BOB Schema](../../contracts/openapi/schemas/bob.yaml) 为准。

客户保存一个当前启用经营主体作为新单据默认值，但不据此限制交易范围。每张销售单据必须明确选择当时有效的经营主体并保存其稳定对象、Approval Entry、编码、名称、税号、地址和电话快照；默认值及经营主体后续变化都不改写已有单据。

客户类型和车辆类型都由 AUX 字典项提供。客户核算账户冻结客户类型 stable ID、编码与名称快照；车辆同样冻结所选车辆类型快照。原“经销商客户”不再作为客户类型；渠道能力由独立 Sales Partner 档案表达。Supplier 不维护 `supplierType`，物流服务使用 Other Unit 表达。

销售订单保存客户类型编码和名称快照，供居间、业绩及后续明确采用它的版本化脚本读取；当前自动定价算法不使用客户类型。实际公式及结果验证属于对应 VOU 脚本版本，字典项本身不保存价格、品牌、提成或业绩规则。

客户类型字典项后续停用不追溯禁用或阻断已批准的客户，最新已批准客户版本仍可用于新销售业务。新建客户或提交、审核客户开放版本时，客户类型 stable ID 必须重新解析为当时启用的 AUX current 对象；开放版本复制了已经停用的类型时，必须先改选当前可用类型。

产品版本选择一个 AUX 产品类型。产品类型可以按业务名称扩展，但每个类型必须绑定一个系统内置行为模板；当前模板为原材料、自制成品、定制成品和包装物。模板只承载系统需要执行的封闭业务规则，产品类型不保存任意行为开关，领域逻辑也不得根据产品类型对象 ID 或名称分支。每个产品具有一个不可管理、无名称、无符号、无对象 ID 的抽象基准单位；它是该产品所有历史和当前数量可以直接汇总的稳定尺度，不是产品版本字段，也不随产品类型或行为模板变化。库存台账和配方计算只保存或消费该尺度上的基准数量，不保存基准单位。

产品类型是普通版本字段。创建首版草稿或从 latest approved 产品编辑出的候选版本都可以改选另一当前启用的产品类型；跨行为模板改选时，调用方必须明确确认并删除不适用于新模板的固定配方、默认包装规格或包装物字段，允许候选草稿暂时不完整。提交和审核只按候选版本最终选择的行为模板校验，候选批准前不影响旧 latest approved 产品和已有 VOU。

每个产品版本独立维护默认录入单位、计价单位，以及一项或多项单位换算。每项换算引用一个 AUX 计量单位并保存正的定点换算系数，按“录入数量 × 换算系数”向前端给出建议基准数量；一个单位在同一产品版本中只能有一项换算。产品提交和审核时，默认录入单位、计价单位以及页面允许选择的其他录入单位都必须存在于该版本的换算项中。换算只服务产品页面和制单页面录入，不是产品数量事实，不要求后端按它计算或校验基准数量，也不得被配方、履约、库存、成本或历史重算使用。

产品计量配置与产品类型正交；交易、配方、履约和库存共同使用调用方已经确认的基准数量，不按原材料、自制成品、定制成品或包装物分支解释录入值。普通商品仍按 kg 定价，包装物按自身计价单位定价并可标记为可回收。

每个非包装产品版本必须直接保存一个大于零的 `defaultPackagingSpec` 定点数，表示一标准包装件对应的基准数量。它是产品版本字段，不是独立对象、独立版本、关联引用或附表记录，也不维护产品交付规格集合。产品版本保存、提交、审核、复制和冻结时整体处理该字段。

默认包装规格不随产品的默认录入单位变化，只作为桶装订单标准计件数的折算口径，不描述客户实际使用的大桶、小桶或散水。实际交付规格属于 VOU 销售订单行；散水的订单选择、槽车要求和每 1000 基准数量一标准件规则由 VOU 保存和执行。

自制成品必须维护版本化固定配方。固定配方由基准产量数量快照和一至两百行原料数量快照组成，
每行只能引用一个已批准的原材料，原料不可重复且基准数量必须大于零。配方只把无单位基准数量作为计算事实；各数量必须同时保存录入数量和单位作为审计快照，但换算系数和建议换算结果不进入配方。配方不依赖产品类型解释数量，也不保存基准单位。配方随产品
版本复制和批准；创建新的产品候选版本时，按每个原料对象自动解析并替换为其 latest approved 版本，同时保持已经确认的基准用量不变。新销售订单复制配方时同样按原料对象解析 latest approved 版本，但保持基准
产量数量快照、原料对象和用量数量快照不变。原料新版本不影响旧产品版本或已经生成的销售订单
配方快照。原材料、定制成品和包装物不维护产品固定配方。

产品草稿允许暂缺默认包装规格、单位配置和自制成品固定配方；创建和保存只校验已经填写的数据是否合法，不要求草稿完整。提交和审核必须通过同一套完整性规则，保证 `APPROVED` 产品满足其产品类型、默认包装规格、单位换算和固定配方约束。产品页面在提交前通过统一的前端检查模块执行对应检查并给出字段级提示，后端仍重复执行同一业务不变量，前端检查结果不能代替后端校验。

客户和供应商都通过 `settlementMethodId` 选择当前启用的结算方式辅助对象。选择时必须把 AUX stable ID 以及交易使用的结算方式名称、术语和到期计算参数复制进引用方版本，形成不可变的类型化快照。已有历史版本和单据快照不会随来源变更被改写；客户和供应商 DCL candidate 配置了结算方式时，提交和审核只校验所存快照的内部完整与参数组合，不回查 AUX current。客户快照另保存销售加价，供应商采购不使用该销售加价。客户和供应商即使提交、审核或批准也可以不维护结算方式；缺失时整组快照为空且 offset 为 0，配置时则必须完整且内部一致。没有明确账期的正式客户或供应商不能用于创建销售订单或采购订单，由 VOU 返回固定 blocker。委托配制制造费等采购加价不属于供应商主数据，由对应专门采购单据维护并保存自身事实。交易单据的到期日和加价规则见 VOU 文档。

Other Unit 可以通过 `settlementMethodId` 保存服务合同使用的可选结算默认快照。它不维护服务范围或默认内部经办员工；每份服务合同自行选择 Employee 并保存快照。

仓库是全局共享的最小物理库存地点，不绑定经营主体，也不按经营主体拆分库存。任一经营主体的业务单据都可以引用同一当前启用且存在 latest approved 版本的仓库；地址和联系人只是仓库资料，不表示库存法律归属或经营主体边界。`managerEmployeeId` 在页面上称为“仓库负责人”，可选且只记录联系与责任，不授予或限制任何仓库操作权限；所有操作仍只使用 APP 精确权限。仓库不再划分库区、库位、储罐或其他库存子位置，所有库存单据、盘点和数量核算都直接使用产品与仓库组合，不增加经营主体子账或位置子账。

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

每个客户核算账户同一时间只能维护一个 `primarySalesAttribution`。`INTERNAL_EMPLOYEE` 引用当前启用 Employee，`EXTERNAL_PART_TIME` 与 `CHANNEL_PARTNER` 引用具备对应能力的当前启用 Sales Partner；Employee 的任职经营主体不限制选择。Customer 与目标 Sales Partner 具有相同强标识时禁止自归属，缺少可比较标识时不推测。版本保存目标 stable ID、精确 Approval Entry、类型、编码和名称快照。

客户版本保存默认运输政策：`defaultTransportMethodCode`、`defaultTransportMethodName` 和 `defaultTransportSurcharge`。运输方式和客户约定运输加价是两个独立事实；加价为非负、最多两位小数的元/kg 定点字符串。客户草稿可以暂缺，提交和审核时必须完整。新销售订单默认带入，允许按单修改，并保存最终运输方式和加价快照。

客户通过 `paymentMethodId` 选择当前启用的 AUX 收款方式。客户版本直接保存 `paymentMethodId`、`paymentMethodCode`、`paymentMethodName` 和 `paymentMethodSalesSurcharge`，不保存 AUX Approval Entry。收款方式回答“使用什么付款媒介”，结算方式回答“何时应付款”；两组快照独立保存、独立影响销售价格，不得合并。客户草稿可以暂缺收款方式，提交和审核时必须保证自身快照完整，不因 AUX current 后续改变而重解释。

客户价格政策把偏离基础报价的金额严格分为销售成本组成、销售溢价和销售优惠。`pricingPolicy.defaultPremiumUnitPrice` 和 `pricingPolicy.defaultDiscountUnitPrice` 是策略内两个互相独立的顶层字段；两者均为非负、最多两位小数的单位价格并默认 `0.00`，允许同时为正数。两项都进入自动价格并由新销售订单分别带入：前者自动增加默认溢价，后者自动给出默认优惠。`defaultDiscountUnitPrice` 同时就是该客户免批优惠单价，不另设审批阈值字段；订单最终优惠单价超过它时必须特殊批准，等于时不触发。整单优惠总额、成本和溢价均不触发该优惠审批。成本组成必须以具名来源单独保存，不进入溢价或优惠字段。

当前自动定价基础数据统一使用人民币，不在客户版本的成本、溢价、优惠、运输加价或第三方居间字段上维护币种，也不提供外币换算。现有交易币种和多币种信用额度不据此扩展客户自动定价能力；将来若出现真实外币定价需求，必须重新确定领域规则，而不是在当前字段中预留换算或回退路径。

客户自动定价中的全部单位价格、整单金额和第三方居间单位值统一保存两位小数。`pricingPolicy` 的四个顶层数值键均必填并默认 `0.00`，`costItems` 必填并默认空数组；任何键均不用 `null` 表示无值。

Customer Version 的核算账户子项使用 `pricingPolicy` 保存上述完整封闭值对象。OpenAPI 和后端拒绝未知键、缺失键、`null`、非法金额、无效成本口径、金额字段组合、零金额成本和重复规范化名称；不得把原始 JSON 映射直接传入领域服务。Customer candidate 复制时完整复制全部账户策略，历史版本保留自己的不可变快照。

当前 `pricingPolicy` 不保存 `schemaVersion`；客户版本本身已经提供历史边界，只有出现已确认的结构变化时才调整封闭契约并明确处理已有版本，不预设规则版本层。首版不为 `pricing_policy` 建 GIN 索引、表达式索引或金额生成列，客户 `query` 也不按定价策略筛选；完整策略只在 `get`、版本详情和实际消费方读取。出现真实筛选或统计需求前不得增加投机性索引。

客户版本历史和候选对比必须先按封闭类型解析 `pricingPolicy`，再分别展示默认溢价、默认优惠、固定第三方居间、浮动第三方居间及按规范化名称匹配的具名成本新增、删除、口径变化和金额变化。页面和审计接口不得向业务用户返回原始 JSON 对比文本，也不得只显示“定价策略已修改”而隐藏具体变化。

客户核算账户以 `creditLimits` 保存按交易币种区分的信用额度，同一币种只能一条。实时占用由 ACC 按账户 stable ID 计算，Customer 不另设或汇总总额度。销售订单超过对应额度时的审批和快照规则不变。

客户核算账户使用 `internalReminder` 保存只供内部查看的选客提示，使用 `defaultSalesOrderRemark` 保存新销售订单默认备注；两者随 Customer Version 整体保存。内部提醒不复制进单据，默认订单备注只在创建订单时复制。

应付款日期只按核算账户结算快照和实际业务日期计算。销售订单的打印数期从同一核算账户上一张合格订单取得默认值，保存后成为订单事实。

客户身份及税务附件归 Customer，合同、价格和交付等业务附件归客户核算账户；两者都随同一个 Customer candidate 复制和审批。只有 `DRAFT` candidate 可以新增、移除或改类，已批准和历史版本只读。附件类别保存 AUX stable ID、编码和名称快照，来源后续变化不改写历史。

服务相关附件分两层保存：Other Unit 的身份、税务及合作资格资料归其 DCL version；正式合同、补充协议、履约证据和验收材料归对应 VOU 单据。两层不得复制形成第二份事实。

### 2.2 客户与供应商结算方式快照

结算方式辅助对象及固定规则由 [AUX 领域](aux.md#33-结算方式)维护。客户核算账户保存所选结算方式的 stable ID、名称、术语、到期参数和销售加价快照；Supplier 保存相同基础快照但不保存客户销售加价。

上述字段作为一组由后端原子复制和校验的结算快照，客户端不能分别拼装。没有配置时，客户核算账户、Supplier 或 Other Unit 的整组字段为空；显式重新选择时才整体替换。AUX 来源后续变化不追溯改变既有版本。

客户核算账户的 `primarySalesAttribution` 必填并引用当前 Employee 或 Sales Partner 精确版本。Supplier 的 `defaultPurchaserEmployeeId` 可引用任意当前启用 Employee，不附加任职经营主体或岗位限制，并保存精确快照。

Customer `save` 提交客户资料和全部核算账户的完整聚合快照，一次替换唯一 DRAFT candidate；不支持账户级保存、JSON Merge Patch 或成本行独立写接口。其他实体继续按各自明确契约保存，调用方不得传入不属于路径实体的字段。

`code` 由服务端按对象实体分配，格式固定为 `PPP-NNNN`：`PPP` 是全局唯一的三位对象前缀，
`NNNN` 是该实体永久递增且不复用的四位流水号。达到 `9999` 后拒绝继续创建。前缀固定为：

```text
customer CUS                 supplier SUP                 other-unit OTU
sales-partner SLP
operating-entity OPE
employee EMP                 product PRD
warehouse WHS
vehicle VEH                  fund-account FAC
```

`name` 长度为 1–200；`currency` 为三位大写字母；`plateNumber` 长度为 1–32。

文本长度按 Unicode 字符数计算：简称和联系人上限 100，电话 32，邮箱 254，地址 500，规格、型号及银行字段 200，说明和备注 1000。`hireDate` 使用 `YYYY-MM-DD`。`vin` 可空，非空时为排除 I、O、Q 的 17 位标准大写格式。`loadCapacityKg` 使用大于零、最多三位小数的十进制定点字符串；返回时规范化为三位小数。`accountNumber` 去除空白和连字符并规范化为大写。

经营主体及每种强类型业务档案的非空强标识分别在自己的实体名录内大小写不敏感唯一，跨类型不比较。产品条码、车辆 VIN、资金账号和车牌的既有占用规则不变。

BOB 不实现任何审核、版本或归档流程。稳定对象编码由服务端生成；DCL 版本 ID、操作者与审计时间同样由服务端和中央 Approval 生成，客户端不得伪造。

### 2.3 Stable identity 与草稿删除边界

BOB 不公开 `delete`。DCL 删除未进入正式历史的 V1 草稿时，必须证明不存在批准版本或持久化引用，再删除 snapshot、Approval Entry 与 subject；业务编码不复用。客户核算账户只有从未进入批准版本且未被引用的草稿子项可以物理删除；已批准账户只能通过 Customer 下一版本停用或移除，历史账户 ID 与 Customer Approval Entry 永久保留。

### 2.4 车辆承运归属

外部承运方使用 Other Unit，不属于 Supplier，也不建立独立物流档案类型。具体合同、送货单或承运业务对该档案的引用表达其物流用途。

车辆 `carrierAffiliation.type` 只有 `INTERNAL` 与 `EXTERNAL`。`INTERNAL` 引用一个经营主体，`EXTERNAL` 引用一个 Other Unit；每辆车只能有一种承运归属。

车辆保存承运对象 stable ID 和 `approvalEntryId` 快照；承运对象后续改版不自动改写车辆，必须通过车辆下一候选显式采用。已有历史单据不被改写。

车辆使用明确的 `bulkLiquidCapable` 布尔能力表示能否作为槽车承运散水，默认 `false`。`vehicleType` 仍只是 AUX 字典分类，VOU 不得根据车型编码或名称猜测散水承运能力；车辆容量、核载量或历史装载量也不形成每车产品数量换算。

车辆申报只维护稳定车辆身份、承运归属、车型分类、核定载重和明确承运能力。DCL 拥有 stable ID、business code、完整候选快照和审批生命周期，BOB 直接读取 highest APPROVED typed snapshot；`/dcl/vehicle` 是唯一维护入口，`/bob/vehicle` 只使用 `query/get`。司机、运输任务、证照到期、维修、轨迹和调度不属于车辆申报字段；实际运输事实由对应 VOU 或物流能力保存，RPT 只读取这些业务事实，不把它们反写为车辆当前资料。

### 2.5 辅助对象与业务对象引用

`productTypeId`、`categoryId`、`employeeCategoryId`、`departmentId` 和 `positionId` 引用对应 AUX 对象；`managerEmployeeId` 和 Supplier 的 `defaultPurchaserEmployeeId` 引用 Employee current。Customer 只有默认经营主体且不维护白名单；Supplier、Other Unit 与 Sales Partner 保存适用经营主体集合和默认值；Employee 保存一个任职经营主体但不形成单据选择限制。已有正式版本和单据继续使用自身快照。

产品分类只允许用于产品，不再为客户、供应商、员工、服务、仓库、车辆、资金账户等对象提供含义宽泛的通用分类。AUX 对象停用或修改后不会追溯改变已经保存的申报版本；只有用户新选择或更换 AUX 对象时才校验当时的 current 状态，后续审核只校验引用方快照完整性。车辆与承运归属对象的严格递归有效性规则仍按 2.4 节执行。

## 3. 聚合模型

### 3.1 Stable subject 与 typed snapshot

全部版本化业务对象使用同一所有权结构：

```text
DCL Subject (stable ID, entity, nullable business code, created metadata)
  └── Approval Entry 1..n (version, status, revision, approval metadata)
        ├── DCL Typed Snapshot 1
        └── Approval Event 1..n

BOB Typed Query
  └── DCL Subject + highest APPROVED Approval Entry + matching Typed Snapshot
```

`dcl_subjects` 不保存 `enabled`、Approval status、version number、revision 或 current pointer；Approval Entry 是唯一版本头，typed snapshot 是唯一业务 payload。Customer typed snapshot 额外包含全部客户核算账户子项。交易只引用明确的强类型档案，客户交易使用 `customerId + accountId + customerApprovalEntryId`；Party 不存在。

### 3.2 DCL 来源与审计

BOB 不建立 `bob_versions`、BOB Approval Entry、版本协调器或审批事件。`query/get/reference` 必须以 entity 和 subject 双重约束选择 highest `APPROVED` entry，再连接对应 DCL typed snapshot；`sourceApprovalEntryId` 与 `sourceVersionNo` 直接来自该 entry。候选、版本历史、审计与历史详情只从 DCL 查询，声明生命周期审计只写中央 `approval_events`。

业务字段尚未确定前，不应仅为追求通用性把全部正式字段长期存入无约束 JSONB。客户 `pricingPolicy` 是因定价规则结构易变而明确限定的封闭值对象例外，不得扩展为通用客户属性包。

## 4. 当前有效资料读取

BOB 没有公开生命周期状态机。所有实体的 `DRAFT`、`PENDING`、`APPROVED`、候选换版、启停申请、版本与审计属于 DCL 和中央 Approval：

- V1 批准前，BOB typed query 无结果；
- V1 批准后，BOB typed query 读取 V1；
- 后续候选未批准时继续读取上一批准版本；
- 新版本批准后，查询自然读取新的 highest APPROVED entry；
- latest approved 反批准后，查询自然回落到上一批准版本，首版反批准后无结果；
- approve/unapprove 不执行 BOB apply、remove、rollback、rebuild 或 refresh。

BOB `query/get/reference` 不接受 lifecycle status 或历史 entry 作为读取模式。候选、版本、审计和启停申请只由 DCL 路由处理；不存在 Party 或档案合并动作。

## 5. 领域动作

公开动作及路径以 [OpenAPI](../../contracts/openapi/openapi.yaml) 为准。BOB 每个实体只登记 `query/get`，共享引用入口登记 `reference/query`；每个动作都是独立 APP 权限。后端通过路由元数据绑定权限标识，不能由 Handler 以字符串前缀或角色名称推断。

每种业务档案使用自己的 BOB 读取权限和 DCL 维护权限，不因现实主体可能相同而隐式授权另一类型。BOB 不提供专用写接口。

## 6. 动作语义与约束

### 6.1 查询

查询请求、筛选、排序和分页结构以 [OpenAPI BOB Schema](../../contracts/openapi/schemas/bob.yaml) 为准。各实体必须在后端定义允许的筛选、排序和关键词字段白名单；客户端字段名和排序方向不能直接拼接进 SQL。资金账号不能进入关键词搜索。

BOB `query` 永远只返回 current 行；DCL 候选状态不进入筛选或响应，候选待审也不改变当前可读结果。

经营主体、仓库、资金账户、客户、供应商、员工、其他单位和销售合作方的 `query` 必须各自在一个只读 `REPEATABLE READ` 事务中完成，直接连接 DCL subject、highest `APPROVED` Approval Entry 和对应 typed snapshot，不连接 Party 或关系 root。查询 SQL 次数不得随页大小增长。

资金账号只在 BOB current `get` 与 DCL 授权历史详情中返回完整值；BOB `query` 摘要和 reference resolver 必须清空 `accountNumber`，也不得把账号纳入关键字搜索。

### 6.2 查看与引用

BOB `get` 只接受稳定对象 ID，并返回 current 类型化详情、`sourceApprovalEntryId` 与 `sourceVersionNo`；current 不存在时返回稳定未找到错误。它不接受历史 `approvalEntryId`，也不返回 Approval metadata、开放候选、版本或审计。

BOB `reference/query` 只返回当前启用对象的最小引用资料。新业务由内部 typed resolver 解析 current DCL 来源；已有业务按自己保存的稳定对象 ID 与精确 DCL Approval Entry 校验历史来源，不通过 BOB HTTP 暴露历史详情。

### 6.3 不存在的公开写动作

BOB 不注册 `create/save/enable/disable/submit/unsubmit/reject/approve/unapprove/delete/versions/audit-history` 路由或权限，也不保留任何路径别名、隐藏页面分支或失败替代数据。所有维护深链进入对应 DCL 页面。

## 7. 并发与事务规则

### 7.1 乐观并发

- BOB HTTP 只读，不接收 revision 写入；
- DCL typed identity reserve/delete 必须锁定 stable subject，并由外层 DCL Approval revision 保护整笔动作；
- 来源、identity 或 Approval 状态已变化时返回稳定冲突，不能自动重放或退回旧来源。
- WFL stable definition 的启停是独立运行开关，不拥有第二套 revision；同一 latest APPROVED `approvalEntryId + approvalRevision` 下的重复或相反启停请求由 subject lock 串行化，并明确以最后一次成功请求为准。

### 7.2 数据库锁

DCL 创建候选、批准、反批准与删除必须在事务内按固定顺序锁定 DCL stable subject、Approval Entry 与相关引用。Customer 同时锁定其全部账户 stable ID；BOB 不参与写事务。

### 7.3 幂等边界

BOB HTTP 读接口天然幂等。DCL lifecycle 写入只依赖自身事务提交或回滚，不建立 BOB current 写入、幂等表、事件重放或补偿写入。

## 8. 有效引用规则

交易领域创建新记录时，必须同时保存：

- 强类型业务档案 stable ID；
- 实际采用的 `approvalEntryId`；
- Customer 子项引用时的 `accountId`；
- 交易领域需要的名称、编码、身份、税务及业务快照。

客户销售和应收引用 `customerId + accountId + customerApprovalEntryId`；采购和应付引用 Supplier；员工业务引用 Employee；普通服务引用 Other Unit；外部兼职与渠道收益引用 Sales Partner。不得保存 Party ID 或用自由文本解释对象类型。

BOB 提供两个不得混用的内部领域能力。`ResolveLatestApprovedReference(entity, objectId)` 用于新建、新选择或主动重选，只接受当前 latest `APPROVED`。`ValidateApprovedSnapshotReference(entity, objectId, approvalEntryId)` 用于已有交易保存未修改引用，只确认 entry 属于该对象、曾正式批准且快照身份一致；它不要求 entry 仍是 latest。两者都必须在交易自身数据库事务中调用，并确认：

1. 对象和 Approval entry 存在且实体匹配；
2. latest 解析的 entry 是该 subject 中版本号最大的 `APPROVED` entry；snapshot 校验的 entry 具有正式批准元数据且身份不可伪造；
3. 对象当前启用；
4. 当前操作者满足必要的数据范围规则。

VOU 已保存的 `objectId + approvalEntryId` 快照在对象产生新批准版本后仍可继续保存；若用户主动重选同一对象，则必须重新解析 latest。候选、最大创建版本和伪造 entry 永远不得作为正式快照。

解析车辆正式引用时，从 BOB current 取得 DCL 来源 `approvalEntryId` 和完整车辆快照，并在同一事务内按 `carrierAffiliation.type` 确认经营主体或 Other Unit 仍存在可用 current。已有业务使用精确车辆 Approval Entry 校验历史快照。

AUX 产品分类、部门、岗位和结算方式只在选择或更换时校验 current 并复制关键值。经营主体、负责人、主要业务归属和默认采购员按 DCL Approval Entry 校验。Employee 的任职经营主体不限制跨经营主体选择；最终经营主体与资金账户仍必须相同。

引用候选在读取时有效不构成写入保证。为避免“校验后、交易写入前”发生编辑失效，交易事务应对对象行取得与 BOB 编辑更新互斥的共享锁，或采用经验证的等效数据库约束/串行化方案。

已经保存的历史业务引用不因后续批准、反批准或启停而失效、级联更新或删除。BOB 表禁止配置会破坏历史引用的级联删除。

## 9. 校验与唯一性

校验分为三层：

1. **传输校验**：JSON 类型、必填字段、长度、枚举和 ID 格式；
2. **实体校验**：各实体字段组合、精度、编码规则和条件必填；
3. **领域校验**：状态、提交人与审核人分离、唯一性、关联对象有效性和并发版本。

`code` 在同一实体的 stable subject 间唯一；客户核算账户 code 只在所属 Customer 内唯一。强标识按业务档案类型、标识类型和规范化值唯一，跨类型不比较。条码、VIN、资金账号和车牌的既有占用规则不变。

## 10. 权限与审计

- 所有接口先由 APP 中间件校验会话、CSRF 和完整 API 路径权限；
- 每类业务档案的 `query/get` 使用独立 BOB 读取权限，不被其他档案权限或 DCL 维护权限隐式包含；
- 查询和详情只返回页面与交易需要的字段，敏感身份资料继续按字段权限裁剪；
- BOB 权限目录不包含任何写入、lifecycle、版本或审计权限；DCL 权限不会使 BOB 页面出现维护控件；
- 创建、维护、候选及审批都使用对应 DCL 精确权限；
- 日志记录 `requestId`、实体、稳定对象 ID、来源 entry 与结果类别，不记录完整税号、账号、联系方式等敏感业务字段；
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

BOB 验收以“当前有效的只读业务资料”公共边界为准，并由各 DCL 实体测试其写事务。至少覆盖：

1. 每个 BOB entity 提供 `query/get`，共享引用提供 `reference/query`；
2. query/get 只读取 current，不返回候选、Approval metadata 或历史读取模式；
3. 每个 current 响应返回 DCL `sourceApprovalEntryId` 与 `sourceVersionNo`，两者来自同一实体、subject 和 approved entry；
4. DCL V1/V2 批准与反批准后，BOB typed query 分别自然出现、切换、回落或消失；候选待审期间仍读取上一批准版本；
5. DCL lifecycle 事务失败时 stable subject、snapshot、Approval 与 event 整体回滚，Customer 账户子项不得部分写入；
6. 新引用只选择 current enabled 对象，已有业务继续按精确 DCL Approval Entry 校验历史来源；
7. BOB 前端只调用 query/get/reference，没有隐藏写分支、lifecycle 控件、版本或审计弹窗；
8. APP 工作台只聚合 DCL 资料待办，查看、编辑、提交、撤回、驳回和批准均深链或调用 `/dcl/{entity}`；
9. BOB 权限目录不含写入与 lifecycle 权限，DCL 权限不会隐式授予 BOB current 读取；
10. 真实 PostgreSQL、HTTP 与 E2E 证明 current、来源版本和权限边界同时成立。

## 13. 待决事项

- 员工与 APP 用户及组织的后续关联方式；
- 产品后续的价格、税率和多币种属性；
- 资金账户后续的账户类型、字段级加密和更细的数据可见范围；
- 是否需要多级审核及委托审核；
- 历史版本和审计记录的保留、归档和脱敏策略。
