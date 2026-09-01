# RPT 报表领域

## 1. 目标与边界

RPT（Reporting）定义、验证、执行和导出面向用户的查询报表。它读取其他领域已形成的事实，不拥有或改写客户、供应商、单据、会计分录、库存数量或核算对象。

RPT 拥有以 `approvalEntryId` 键控的技术有效性（VALID/INVALID）、按报表授权的查询与导出，以及运行时审计。报表定义的 stable ID、code 与创建审计在 DCL subject；候选编辑、提交、撤回、驳回、批准、反批准、草稿删除、版本历史和审计读取也由 DCL 统一拥有。RPT 不保存 definition root、root revision、current pointer 或业务 snapshot；它只保留执行与独立 VALID/INVALID 规则。它不拥有 ACC 查询投影、第二套角色权限、用户账簿分配或执行层账簿过滤，也不提供未授权报表菜单或集中报表中心。

公开动作、路径和数据结构以 [OpenAPI RPT Schema](../../contracts/openapi/schemas/rpt.yaml) 为唯一线协议来源。

## 2. 首批报表

所有报表统一由 stable definition 与 Approval Version 提供。首批预置报表 SQL 可以直接读取各领域内部数据表，不经 ACC 查询接口，也不建立报表投影或只读视图。

### 2.1 科目流水与科目余额

科目流水按报表定义声明的账簿、科目、辅助核算维度、币种和日期范围展示会计事实；科目余额按同一口径汇总借贷发生额和余额。ACC 仍只保存事实，RPT 负责面向用户的查询和导出。

### 2.2 应收预收与应付预付

应收预收、应付预付分别按账簿、往来单位、币种和截止日展示原额与净额，并按到期日和先进先出倒推未结金额及账龄。报表必须区分应收与预收、应付与预付，不把不同方向抵销成无法解释的单一余额。

客户账龄和供应商账龄的最小账龄天数筛选必须大于或等于 0；`0` 表示不排除任何非负账龄，负数不得进入查询或导出执行。

### 2.3 库存

库存报表按账簿、库存科目、仓库、产品和截止日展示期初、入库、出库、期末数量、移动平均单价和金额，并支持下钻到来源 VOU。库存金额和成本口径直接取对应会计账簿的库存数量及成本事实。

### 2.4 票据

票据报表合并全局票据身份及状态与所选账簿的资产或负债方向和会计金额。来源相对方筛选以稳定 `counterpartyObjectId` 进行；候选和历史事实始终保留 `entity`、stable object ID、精确 `approvalEntryId`、编码和名称快照，不以 Party 或当前档案重解释。全局身份和状态不因账簿查询而复制；账簿金额仍按所选账簿独立展示。

### 2.5 空桶

空桶报表按客户、桶型和截止日展示期初、发出、收回、调整和欠桶余额；配置金额核算时同时展示金额。数量状态取全局空桶事实，金额取所选会计账簿的独立价值。

### 2.6 员工借款

员工借款报表按账簿、员工、币种和截止日展示借款、还款、费用核销、余额及先进先出账龄。余额为负时必须明确标识为应付员工，而不是继续显示为员工借款。

## 3. 报表定义与 DCL

报表定义的生命周期完全由 [DCL 报表定义申报](dcl.md#39-报表定义申报) 拥有。`/dcl/rpt-definition` 是唯一维护入口，覆盖创建、保存、提交、撤回、驳回、批准、反批准、删除、版本和审计。RPT 不保存 `currentVersionId`、effective pointer、next pointer 或 domain version header。

最新 `APPROVED + enabled + VALID` entry 是唯一执行版本。不存在这类 entry 时定义不能执行；开放候选和非最新批准 entry 不能执行，也不能替代正式版本。`enabled` 是 DCL typed snapshot 的版本事实，仅 DRAFT candidate 可以修改；当前 approved 定义需先创建下一候选。前端状态、徽标、动作和版本历史中文语义统一使用 `frontend/src/shared/approval/`，不在 RPT 另建状态映射。

## 4. 查询 SQL 安全与版本契约

每个版本 payload 包含单条只读 SQL、类型化绑定参数和显式结果列契约。SQL 只允许一条 `SELECT` 或 `WITH ... SELECT`，由数据库只读角色在只读事务执行；禁止字符串拼接、多语句、写入、DDL、可写函数和绕过只读角色的路径。参数类型为 `TEXT`、`INTEGER`、`DECIMAL`、`BOOLEAN`、`DATE`、`DATE_RANGE`、`ENUM` 与受控 `REFERENCE`；受控引用只开放会计账簿、会计科目、客户、供应商、其他单位、员工、部门、产品、仓库、资金账户、资产、票据和票据已记录的原始往来方，执行时只绑定稳定 ID。票据原始往来方候选读取票据事实中的历史快照，不以当前主数据覆盖历史名称。

`CUSTOMER_ACCOUNT` 候选只读取 Customer 最新 `APPROVED` 且启用的内嵌账户快照；每项返回账户 stable ID、账户 code/name 和所属 Customer code/display name。账户 code 只在 Customer 内唯一，界面必须同时展示 Customer code 与账户 code。

结果列必须声明 SQL alias、显示名、顺序、数据类型、宽度、默认可见性和格式。批准时实际返回列必须与契约完全一致；页面和导出只按该 entry 的列契约展示，不能自行猜测字段含义。查询每页最多 100 条，导出最多 100,000 条；两者都有只读事务、超时和资源限制。预置 SQL 依赖的科目编码变更时，同次变更必须提供并批准兼容新版本或明确停用受影响定义；不保留兼容视图、别名或第二套口径。 <!-- docs-check: legacy-exception=release-gate ref=ADR-0026 -->

## 5. 批准、执行与有效性

approve 前必须验证：单条允许的只读 SQL、参数占位符与类型声明、只读角色的 `PREPARE` 和无 `ANALYZE` 的 `EXPLAIN`、审批人验证参数下的限量试跑，以及实际返回列与契约完全一致。任一步失败都不得批准。

技术有效性独立于 Approval：唯一值为 `VALID | INVALID`。`APPROVED + INVALID` 合法，但该 entry 不可执行；RPT 停止其 query/export，并且绝不改为执行较低版本的 APPROVED entry。确定性的 SQL 结构错误（不存在表、列、函数或类型不匹配）将该 entry 标为 INVALID 并停用该定义的 query/export 权限；连接失败、超时等瞬时错误只返回运行错误，不改变有效性。恢复只能批准一个重新验证过的新版本，且新 latest APPROVED 必须是 VALID。

## 6. 权限、菜单与定义启停

DCL 定义及其版本的 `query|get|create|save|create-next|delete-version|versions|audit-history`、完整 Approval 生命周期和 DRAFT candidate `enable|disable` 是独立高权限管理动作；普通使用者的 query 与 export 按报表 stable code 分别授权。首次批准时，RPT 与 APP 在同一事务注册该 code 的精确 `query`、`export` 权限；草稿不创建使用权限。latest approved snapshot 的 enabled 为 false、没有 latest APPROVED 或 latest APPROVED 为 INVALID 时，查询与导出不可用，但既有角色关联和审批/运行审计保留。

获得某报表的 query 或 export 权限即可读取该定义 SQL 返回的全部数据，包括跨账簿数据；RPT 执行层不追加 ACC 账簿过滤。APP 对每个有权限的 code 生成独立 `/rpt/{code}` 菜单项；普通页面只加载该 code，不显示报表中心。定义管理页已迁入 `/dcl/rpt-definition`，不与普通报表页混合。

## 7. 发布门禁与验收边界

数据库基线变化必须在重建内测库前验证全部 enabled definition 的 latest APPROVED + VALID entry；任一不兼容即阻断发布。继续发布前，必须在同次变更中提供并批准兼容的新版本，或由管理员明确停用受影响定义；不得为旧表或字段保留兼容视图、别名、fallback 或第二套查询口径。 <!-- docs-check: legacy-exception=release-gate ref=ADR-0026 -->

验收覆盖 stable definition 与 V1/V2、候选删除复号、完整 Approval 生命周期与 reason、exact entry 读取、latest-only unapprove 和执行、VALID/INVALID 独立、APPROVED+INVALID 停止执行且不改用其他版本、SQL/参数/列契约批准门禁、独立 query/export 权限、跨账簿授权、动态菜单、八类首批报表口径，以及任一事务失败整体回滚。
