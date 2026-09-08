# 第三批最终集成验收 #405（2026-09-08）

## 范围与事实来源

承接 [#392](https://github.com/hansonyu183/zerp/issues/392) 及 #393–#404，验收基线为 `281649f3`，沿当前分支继续提交本次修复。本记录不表示推送、合并、部署或关闭父票；GitHub 子票状态仍为 OPEN，实施事实以当前代码、提交及下述验证为准。

按用户授权直接使用 `zerp` 数据库。没有调用会进入 `target-db down --volumes` 的 Make 聚合命令，没有重置数据库、恢复 CI、建立备份/隔离工程或部署。临时浏览器 API/Web 使用当前代码；复用现有夹具和浏览器用例，资料维护场景的夹具放入外层回滚事务。该浏览器承载串行处理 HTTP 请求，不能代替真实多连接并发测试。

## 13 个原 DCL 实体

| 原实体                 | 当前唯一资源                   | 当前能力                                        | 真实消费者及验证边界                                           |
| ---------------------- | ------------------------------ | ----------------------------------------------- | -------------------------------------------------------------- |
| operating-entity       | aux/operating-entity           | 直接维护、独立启停；无审批/版本                 | AUX 页面、aux-people-current、VOU/ACC 采用快照                 |
| employee               | aux/employee                   | 直接维护、独立启停；无审批/版本                 | AUX 页面、aux-people-current、历史姓名及归属快照               |
| warehouse              | aux/warehouse                  | 直接维护、独立启停；无审批/版本                 | AUX 页面、aux-assets-current、VOU/库存 blocker                 |
| fund-account           | aux/fund-account               | 直接维护、独立启停；无审批/版本                 | AUX 页面、账号唯一性、VOU/ACC typed snapshot                   |
| vehicle                | aux/vehicle                    | 直接维护、独立启停；无审批/版本                 | AUX 页面、车牌/VIN、内部及外部承运引用                         |
| product                | bob/product                    | 独立启停 + 公共 Approval/Version                | 产品临时表单、数量试算、提交/审批/历史，VOU 产品并发与冻结单位 |
| customer（含子单位）   | bob/customer                   | Customer 聚合整体 Approval/Version、独立启停    | 完整客户表单、两个子单位、附件、历史差异与销售收款采用         |
| supplier               | bob/supplier                   | 独立启停 + 公共 Approval/Version                | 资料、提交记录、批准、历史与启停                               |
| other-unit             | bob/other-unit                 | 独立启停 + 公共 Approval/Version                | 资料、提交记录、批准、历史与启停                               |
| sales-partner          | bob/sales-partner              | 独立启停 + 公共 Approval/Version                | 合作能力、提交记录、批准、历史与启停                           |
| acc-mapping            | acc/mapping                    | 当前配置、revision；无审批/版本                 | 真实映射编辑、VOU 记账、历史分录保持采用时事实                 |
| rpt-definition         | rpt/definition；rpt/rpt-NNNNNN | 当前定义；使用者只读查询/导出，无审批/版本      | 定义校验、精确查询/导出权限、参数及列契约                      |
| wfl-process-definition | wfl/process-definition         | WFL 独立消费公共 Approval/Version，独立运行开关 | 真实定义编辑/试跑/审批与固定版本实例继续执行                   |

`third-batch-session.int.test.ts` 经真实 signin/restore 核对上述归属与能力，逐个请求 13 类旧 DCL 资源的读取、提交、版本、审批、启停和删除路径，全部为 404。Session 不提供 DCL 权限；VOU opening 有审批、无版本，ACC opening 旧入口不在 Session 中。共享库权限与生成目录逐条相等（732 条，DCL 为 0）。

生产入口从 `app.ts`/Hono 注册、生成契约、前端 Registry、navigation、api.ts 和模型导入核对。删除 DCL 导航展示规则、BOB 路由工厂旧域/读取动作参数及共享模型/VOU 历史引用中的 DCL 回退。旧表、迁移命令、附件历史存储键和测试夹具清理代码保留各自历史/工具职责，不提供生产 DCL 写入、代理或别名。AUX 仓库停用不再读取 `dcl_warehouse_usage_facts`，当前库存、待处理单据、未完成订单和当前引用仍产生 blocker。

## 页面与生命周期

七个既有页面为 app/user、app/role、aux/employee-category、aux/position、aux/measurement-unit、aux/payment-method、aux/asset-category。登记函数、公共 VM 和挂载组件测试继续验证完整 id/code/py/name/enabled、keyword、必需列、唯一末尾 actions、有限字段闭集、decimal 精度、false/0、范围深复制、乱序与销毁隔离、取消不刷新、确认成功刷新一次及未知写入不被普通刷新解锁。具体字段清单见 [#393 证据](dynamic-fields-issue-393-2026-09-07.md)。

VOU 目录中的 36 类普通单据均进入独立 VouListPage，拥有单独只读详情及通用审批。逐类型筛选、摘要、手工新建资格、精确路径及详情/编辑/审批矩阵见 [#403 目录矩阵](vou-catalog-issue-403-2026-09-08.md)；销售/采购的专有条件与摘要见 [#402 证据](vou-order-pages-issue-402-2026-09-08.md)。这些普通单据的专用新建/克隆/编辑页面仍未实现，不显示伪回调，列表接入不等于完整单据编辑器交付。

第 37 类 `vou/opening` 提供独立列表、临时录入、克隆、明确删除原开放提交、提交、审批、审计及未知结果核实。期初只使用 Approval；零期初、逐币种平衡、科目/维度/库存和后续账务 blocker 由 VOU/ACC 同事务协作。期初提交和删除的 `invalid_response` 现与网络中断、internal_error 一样锁定为未知结果，禁止重放，分别通过原提交身份或匹配原 revision/操作者的删除审计核实。

BOB 与 WFL 各自组合公共 Approval/Version，VOU/期初仅 Approval；AUX、ACC 映射和 RPT 定义没有隐藏审批或自动批准。RPT SQL 执行保持只读事务，既有版本不构成配置回退。

## 临时输入与历史连续性

当前源代码没有 IndexedDB Draft 存储、自动保存、恢复、草稿列表或替代持久化。localStorage 仅保存主题偏好 `zerp-theme` 与跨标签退出通知 `zerp-session-event`，不保存表单内容；不存在可精确识别的旧应用草稿数据库，因此未删除任何浏览器数据库。已提交附件继续按保存的键读取，不迁移或删除业务附件。

真实 BOB、AUX、ACC、WFL、期初页面及公共 VM 覆盖确定失败保留输入、关闭/刷新/切换账号销毁、克隆仅预填新表单、提交幂等与未知写入核实。旧 ADR-0051 的 IndexedDB 条款明确由 ADR-0053 取代；ADR-0052 更新为完成后的领域归属。APP 工作台、ACC 映射、AUX 采用表及 VOU 数量规则中遗漏的旧 DCL 当前语义已修正。历史 ADR 的原决定保留为决策背景，领域文档描述当前规则。

当前基线上成功重跑 Customer、ACC mapping、RPT、WFL、VOU opening 的迁移事务验证，覆盖稳定 ID、历史内容/引用/附件、原 Approval Entry/审计和精确授权，以及失败整体回滚。BOB 正式资料、enabled 独立性、最高批准版本、WFL 旧实例固定 entry、VOU 历史快照及公共 CAS/审计事务通过当前行为测试。未重建已经消失的 AUX/三档案/Product 旧来源；其迁移前后测试未在本轮重新取得通过结果，见下列未覆盖项。

## 验证记录与限制

分项执行 Hono 生成、Kysely 类型生成（从现有 `zerp` 读取 138 张表，格式化后与仓库无差异）、API/client/model/frontend 类型检查、前端 lint/build、模型/API/前端测试与文档检查。禁止把首次全套集成尝试记为全绿：首次 92 项中 65 通过、25 失败、2 跳过；后续按失败原因修复并分项复验。

当前候选通过证据：API 单元 81 项、生成/schema 工具 19 项、model 31 项、前端 VM/普通组件 220 项及真实 Vuetify 组件 10 项；集成用例合并首次有效证据与后续复验，去重后 82 项通过，4 项跳过，6 项受旧基线/运维入口限制未通过。以下限制保留，不宣称整套集成命令全绿。

浏览器按真实入口去重 30 项通过：七页/AUX/BOB/ACC/导航/订单 23 项，RPT 查询与仅导出 2 项，WFL 固定版本实例 1 项，全普通单据目录 2 项，期初 2 项。使用现有 `frontend/tests/target-e2e` 对应 spec；全目录与期初分别运行 `pnpm --filter @zerp/api e2e:vou-catalog`、`e2e:vou-opening`，其余使用已有 Service 夹具配合本机临时 Hono/Vite。订单采用 `seedOrderListFixture` 专项复验，没有把通用夹具中失败的订单结果记为通过。浏览器测试中的旧客户“未实现”断言和客户提交搜索竞态已修正。缩放出现既有 ResizeObserver 通知，生产构建保留 chunk 大小提示，宽度和交互断言通过。

- `app-user-management` 原夹具漏传授权 scope，修复后与 `third-batch-session` 复验共 17 项通过；最后管理员用例因存在共享管理员而跳过。真实多连接 CAS/角色并发通过，未借浏览器串行夹具证明并发。
- `target-online-test-user-seed` 仅允许空库验证；现有用户时在登记清理钩子前关闭连接并跳过。本轮不证明空库首次初始化及凭证轮换路径，保留该路径原创建/更新断言。
- AUX people/assets 的 4 个迁移测试因当前库已无所需旧表而失败；三档案及 Product 的 2 个迁移测试因已转换而跳过。本轮不伪造迁移执行证据，也不重建旧来源。
- legacy-menu-cleanup 与 user-pinyin-backfill 两个旧运维测试硬编码 isolated scope，不适用于当前共享库，本轮未取得通过结果。现行 schema 及生成物、当前目录、当前用户拼音行为另有通过证据。
- 普通单据专用编辑器、所有类型的完整过账算法和生产发布不属于本次完成声明；没有关闭 #392 或其他父票。

## 共享环境与收尾

首次尝试旧 online-test seed 测试时，其错误清理钩子移除了 `test-admin`、`tester` 的角色关联和会话。通过既有 `seed:online-test` 校准恢复两者原 `superadmin` 角色，结果 `created=0, updated=0`，账号和密码未改变；已注销会话不可恢复，需要重新登录。此问题已告知用户，测试改为前置非空库判断，避免再次触及共享身份。

首次配置失败遗留的测试身份按本轮开始时间、随机测试前缀和引用范围核对后，在事务中精确清理 120 个临时账号及 85 个角色。浏览器回滚夹具不持久化业务样例；RPT 独立只读执行夹具按本轮身份清理。临时 API、Vite、浏览器和附件测试目录由本任务回收，共享数据库及既有服务保留。

## Standards

独立规范审查发现首次 seed 调用在调整前置条件时被误删，已恢复创建及计数断言并复核；最终无未解决规范发现。空库路径只做静态复核，未以共享库 skip 替代运行证据。

## Spec

独立规格审查发现期初 invalid_response 未按未知写入锁定，以及验收记录漏记主题存储；均已修复并复核。最终无未解决实现发现；上述历史基线与共享环境验证限制保持明确。

两轴未解决发现均为 0；验证限制不因审查通过而消失。

## 合并前 CI 补验（2026-09-08）

本节记录 PR #406 合并前新增的隔离验证，替代上文关于旧基线、空库和运维测试未取得通过结果的当前状态；上文保留首次共享环境验证的历史经过。

- `generate:db` 统一执行仓库 Prettier 格式化，`make generate` 从当前 SQL 创建的 138 表空库生成类型。删除误加到全局对象登记的映射字段；映射身份和 revision 只属于按账簿生成的会计凭证，与领域规则、实际写入及已执行迁移一致。
- 当前集成测试共 86 项，完整首跑 85 通过、1 项因隐含依赖预存 superadmin 角色而失败；修复该测试自行创建及清理角色后，两项权限迁移测试复验通过。空库 seed、最后授权管理员、旧菜单清理和拼音回填均实际执行，零跳过。
- 四组历史迁移独立运行 `test:migrations`，共 6 项全部通过、零跳过。固定的旧 SQL 与必要权限目录保存在 `apps/api/tests/migrations/baselines/`，每组仅装载到本轮独立随机 schema，结束后删除；不读取或重建线上旧表，也不依赖 squash 后旧分支仍存在。
- 通用浏览器入口明确排除需要独立事务夹具的 WFL、全目录和期初 spec；`make target-e2e` 按顺序执行三个正式专项入口。缺少专项夹具时测试失败，不再静默 skip。
- 通用浏览器首跑 27 项中 26 通过，订单测试混淆初次查询与筛选查询。改为等待初次查询、断言日期输入并精确匹配单号请求后，订单两项测试连续三轮通过。

远端旧一轮日志还暴露资产类别测试跨视口复用了已从 120 改成 240 的同一记录，却仍断言初值 120；改为各视口编辑自己创建的记录后，`--repeat-each=3 --retries=0` 三次全部通过。

专项入口复验 WFL 1 项、全单据目录 2 项、期初 2 项全部通过、零跳过；临时 Hono/Vite 全部关闭，事务夹具回滚。浏览器按用例去重共 32 项取得通过结果（包括通用入口中的 WFL Starlark 浏览器一致性测试）。

本机 Docker 构建使用一次性 npm DNS 覆盖解决当前网络解析问题，未写入 CI 或生产配置。最终受保护检查以 PR #406 对最终提交执行的 `ci-required` 为准，不把分项复验表述为单次完整命令通过。
