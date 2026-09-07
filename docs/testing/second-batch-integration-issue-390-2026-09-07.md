# 第二批集成验收 #390（2026-09-07）

## 候选与结论

本轮验收基线为 `ffb607464d7c667f16b7f104c8c095335d2ba2c6`，沿用 `codex/issue-386-aux-management` 集成分支。该 SHA 已包含 #385–#389 的本地实现；GitHub 前序票仍为 open，不能据提交消息推导已合并或已发布。本轮补证和死导出清理提交为 `0dade63ce584204a67120b8d3d00bf53d22461fb`，该阶段补证使用该提交内容，并复用未改变的运行时容器验证。后续两个 VOU 修复切片使用重新构建的容器执行最终验收，详见本文末尾。本文逐项核对父 Issue #384 的 B2-01 至 B2-26，记录当前证据及真实缺口，不替代领域规则。

用户已确认将两个 VOU 缺口按独立切片修复。B2-16 已以 `c3ca4c40` 独立提交；B2-17 已补齐销售订单最终收款快照，最终 API 集成 56/56、前端单元 124 项及真实 Chromium 14/14 全部通过。本地候选满足 B2-01 至 B2-26，#390 的实现和验收工作已完成。没有改写父 Issue、关闭前序票、推送、合并或生产上线。

## 七页实际调用链

共同入口是 `main.ts → Router/AppLayout → Session apiPaths → navigation/resources.ts → ResourceHost.vue → navigation/registry.ts`。Host 先判断当前导航资源资格，实例 key 包含 Session generation；撤销或更换会话销毁旧实例。页面使用 `ListPageShell.vue`、`components/list-page/vm.ts` 和各模块编辑器；`frontend/src/target/api.ts` 只消费从 Hono 路由推导的 `@zerp/api-client`。

| 资源                  | 页面/状态模块（相对 `frontend/src/target/pages/`）                         | 真实后端                                                              |
| --------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| app/user              | `app/user/UserManagement.vue`、`app/user/vm.ts`                            | `independent-contract.ts → independent-routes.ts → ManagementService` |
| app/role              | `app/role/RoleManagement.vue`、`app/role/vm.ts`                            | 同上，角色 query/get/create/save/enable/disable                       |
| aux/employee-category | `aux/employee-category/EmployeeCategoryManagement.vue`、`aux/simple/vm.ts` | AUX literal route → `AuxService`                                      |
| aux/position          | `aux/position/PositionManagement.vue`、`aux/simple/vm.ts`                  | AUX literal route → `AuxService`                                      |
| aux/measurement-unit  | `aux/measurement-unit/MeasurementUnitManagement.vue`、同目录 `vm.ts`       | AUX literal route → `AuxService`                                      |
| aux/payment-method    | `aux/payment-method/PaymentMethodManagement.vue`、同目录 `vm.ts`           | AUX literal route → `AuxService`                                      |
| aux/asset-category    | `aux/asset-category/AssetCategoryManagement.vue`、同目录 `vm.ts`           | AUX literal route → `AuxService`                                      |

Registry 恰好七项。人员类别/岗位复用同构名称说明表单和 simple VM 的静态 typed 工厂，三个专有 AUX 页面各有 typed VM/编辑器。未登记的其余七个 AUX 管理页，以及 BOB/DCL/VOU/ACC/RPT/WFL 等资源继续显示“功能尚未实现”；它们的授权菜单、现存后端 API、引用 blocker 和历史事实仍保留。页面缺失不等于无权限或 API 已删除。DCL、审批、业务版本与 ACC 期初迁移均未在本批完成。

## 公共边界、契约与结构

`apps/api/src/enablement/service.ts` 的 `changeEnablement` 接受外层事务和最小 typed store，依次完成输入校验、读取当前事实、大整数 revision 校验、同态拒绝、领域前置规则、CAS 写入、领域后置副作用及通用审计。APP user、APP role、AUX 都真实调用它。用户停用撤销会话、启用不复活；角色停用保留关系和会话，下一个受保护请求重新计算权限。AUX 保留域写锁及实体规则。通用审计失败时状态、revision、关系及副作用在同一事务回滚。

存储保持 `app_users.status/revision`、`app_roles.status/revision`、`aux_objects.enabled/revision` 为各对象的唯一事实，审计复用 `app_audit_events`。没有第二状态表、第二 revision、公共启停 HTTP API、菜单或独立业务域。`platform/pinyin.ts` 仅调用 pinyin-pro 进行既定纯转换；用户写入和回填仍属于 APP，角色/AUX 查询在完整集合计算拼音并匹配后分页，没有新增拼音存储或回填工程。

角色管理和全部十二个 AUX 管理实体采用原生 `id/code/py/name/enabled/revision`，写入使用十进制字符串 revision；动作集合为 `edit/enable/disable`。角色类型 `NORMAL/SYSTEM/SUPERADMIN` 和权限自身 `ENABLED/DISABLED` 保持原含义。用户角色消费者逐页加载 `enabled/type/assignable` 候选并合并已关联的停用或不可分配角色。旧角色 status、AUX 管理 objectId/objectRevision、数字 revision 与服务端生成字段由 strict Hono/Zod 输入拒绝；存续引用和历史快照中的 objectId 不是管理协议兼容入口。

本轮清理 `AuxData` 无外部消费者的旧泛型导出，将其限定为 AUX Service 内部类型。现有 typed 公开接口 `AuxDataByEntity` 保留。独立只读审查从入口、literal route、导入和调用链未发现另一套启停实现或旧角色/AUX 管理输入通道。

相对第二批基线 `58bee225`，实际 SQL 变化来自 #389：`vou_asset_acquisition_line_snapshots` 增加 `category_default_useful_life_months` 和 `category_default_residual_rate_hundredths` 两个快照列及简单范围 CHECK。B2-16 修复另在订单产品行、配方产出及配方原料的既有快照表增加单位编码、名称、符号和数量精度列；没有新增业务表。B2-17 在 `vou_sale_order_details` 增加方式 ID、编码、名称、定点加价和采用来源五列及全有/全无形状约束；合法空客户快照仍保存空值。公共启停及拼音没有引入表、函数、存储过程或触发器。

## B2 验收矩阵

下表的测试文件为本轮实际运行的候选测试；失败或待执行项不计为通过。历史报告仅提供前序红绿过程和设计边界，当前通过结果以本轮命令为准。

| ID    | 覆盖票         | 实际证据                                                                                                                                                         | 结果 |
| ----- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| B2-01 | #385–#389      | Registry 静态七项；七页 E2E 从菜单进入真实 Shell/编辑器                                                                                                          | 通过 |
| B2-02 | #385/#390      | navigation E2E；navigation-resources、Host VM/component；单项非 query 角色 E2E                                                                                   | 通过 |
| B2-03 | #385/#386      | 三个真实 Service 消费共同 `changeEnablement`；APP/AUX PostgreSQL 启停测试                                                                                        | 通过 |
| B2-04 | #385/#386      | app-user-management、aux-management 的同 revision 并发唯一赢家、陈旧和同态拒绝                                                                                   | 通过 |
| B2-05 | #385/#386      | APP/AUX 真实大整数 CAS；app-role-contract、aux-contract 拒绝数字并精确保留字符串                                                                                 | 通过 |
| B2-06 | #385           | app-user-management 的 disable revokes every target session、enable does not revive；用户浏览器自助流程                                                          | 通过 |
| B2-07 | #385           | role enablement keeps user role references and sessions；真实旧会话请求拒绝 E2E                                                                                  | 通过 |
| B2-08 | #385/#390      | system/self/ceiling/final administrator 真实事务；本轮补名称 trim/大小写冲突与 superadmin 拒绝                                                                   | 通过 |
| B2-09 | #385           | app-user VM 的全部候选页与停用关联合并；真实 HTTP assignable roles；用户编辑器角色分配 E2E                                                                       | 通过 |
| B2-10 | #385           | role create/save exact write permission；停用权限显式移除；角色 VM 分页目录与依赖权限                                                                            | 通过 |
| B2-11 | #385/#390      | user E2E 创建单项角色→分配用户→恢复 Session→无 query→停用后旧请求拒绝→菜单撤销                                                                                   | 通过 |
| B2-12 | #385/#386      | role/AUX Hono 契约测试及真实 HTTP 原生列表                                                                                                                       | 通过 |
| B2-13 | #385–#389      | app-user-management/aux-management 匹配后分页；七页真实名称/编码/拼音查询及 >20 条数据                                                                           | 通过 |
| B2-14 | #386           | 十二实体共享 Hono 工厂和 literal routes；aux-contract 全实体协议覆盖                                                                                             | 通过 |
| B2-15 | #385/#386      | 原生创建/改名；AUX PostgreSQL current name 查询；strict 输入拒绝 code；事务失败回滚                                                                              | 通过 |
| B2-16 | #387/#390      | measurement-unit 契约/VM/E2E 边界；archive-lifecycle 历史产品单位快照不变；VOU 公开 submit/get 验证产品精度、完整单位快照及历史稳定性                            | 通过 |
| B2-17 | #388/#390      | payment-method 契约/VM/E2E 大额定点与非法输入；archive-lifecycle 客户旧快照不变；VOU CUSTOMER/CURRENT 与空值校验、独立快照持久化/审批/历史读回、真实删除 blocker | 通过 |
| B2-18 | #389           | asset-category E2E 合法端点/非法字段；acc-core 购置采用快照及台账历史不变                                                                                        | 通过 |
| B2-19 | #386–#389      | aux-management 引用 blocker；archive-lifecycle 新采用拒绝及历史读取；acc-core 类别新采用拒绝                                                                     | 通过 |
| B2-20 | #385–#389      | 公共 list VM 可控 Promise；user/role/AUX VM；Host dispose/Session generation 组件测试                                                                            | 通过 |
| B2-21 | #385–#389      | VM 写成功刷新失败、取消、未知结果锁定不重放；专有 AUX E2E 故障反馈                                                                                               | 通过 |
| B2-22 | #385/#386      | platform/pinyin 纯工具及 APP/AUX 查询顺序；真实拼音分页测试                                                                                                      | 通过 |
| B2-23 | #385–#389      | 七页 desktop/390px E2E；岗位移动编辑器/人员类别桌面截图人工复核                                                                                                  | 通过 |
| B2-24 | #385–#390      | 严格旧输入拒绝；入口/导入/调用链核查；删除 AuxData 死导出；未迁移范围如实列明                                                                                    | 通过 |
| B2-25 | #385/#386/#389 | APP/AUX 审计故意失败 PostgreSQL 回滚；ACC/VOU 类别候选失败无部分写入                                                                                             | 通过 |
| B2-26 | #390           | 独占 Compose 与回环端口；未运行备份/恢复/CI；保留共享服务                                                                                                        | 通过 |

## 本轮命令

所有命令从仓库或对应 pnpm workspace 执行。连接参数仅在受控进程环境中注入，不在本文记录凭证。日志位于本任务临时忽略目录，不提交测试账号、数据或附件。

| 命令                                                                                                                                                                | 退出码 | 结果                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------- |
| `pnpm --filter @zerp/api generate:artifacts`                                                                                                                        | 0      | Hono OpenAPI/权限生成                             |
| `pnpm --filter @zerp/api generate:db`                                                                                                                               | 0      | 对专用库生成 133 表类型                           |
| `git diff --exit-code -- apps/api/src/generated apps/api/src/db/generated.ts`                                                                                       | 0      | 无生成漂移                                        |
| API、api-client、model 的 `typecheck`                                                                                                                               | 0      | 三 workspace 通过                                 |
| 前端 `typecheck`、`lint`、`format:check`、`build:target`                                                                                                            | 0      | 构建仅有既有 >500 kB 分包提示                     |
| `pnpm --filter @zerp/frontend test:unit`                                                                                                                            | 0      | 18 文件 114 项及 Vuetify 10 项                    |
| `pnpm --filter @zerp/api test:unit`                                                                                                                                 | 0      | 45 项，无跳过                                     |
| `pnpm --filter @zerp/api test:artifacts`                                                                                                                            | 0      | 20 项，无跳过                                     |
| `pnpm --filter @zerp/api sync:catalog`                                                                                                                              | 0      | 专用库目录同步                                    |
| `pnpm --filter @zerp/api test:integration`                                                                                                                          | 0      | 52 项，0 失败、0 跳过；新增角色补证另行记录       |
| `pnpm --filter @zerp/api e2e -- session.spec.ts navigation.spec.ts user.spec.ts aux.spec.ts measurement-unit.spec.ts payment-method.spec.ts asset-category.spec.ts` | 0      | 14 项，七页及 Session/导航真实 Chromium，3.6 分钟 |
| `node --test --test-name-pattern='name collisions\|system, own-role' tests/integration/app-user-management.int.test.ts`（API workspace）                            | 0      | 两项真实 HTTP/PostgreSQL 补证，无跳过             |
| 专用 Compose `config --quiet` / `up -d --wait target-db`                                                                                                            | 0      | 专用 PostgreSQL 健康                              |
| 专用 Compose 首次 `build target-api target-web`                                                                                                                     | 1      | 容器 registry.npmjs.org DNS `EAI_AGAIN`           |
| 同构建加入本任务临时 `extra_hosts` 后，随后 `up -d --wait target-api target-web`                                                                                    | 0      | API/Web/DB 全部健康，未修改仓库网络配置           |

没有运行默认 `make generate/e2e`：其 `target-db` 会对默认 `zerp-target` 执行 `down --volumes --remove-orphans`。本轮拆开运行实际生成、检查、测试入口并显式指向任务专用实例，不把共享库当初始化目标。没有执行 CI 工作流测试、远端 CI、备份或恢复演练；WFL parity 不属于本轮未改动路径，未重复运行。

## 已授权的 VOU 修复切片

- B2-16：销售及采购订单行和配方产出、原料采用完整单位快照，提交按对应产品当前有效版本的单位配置核对五项事实，并按实际定点值检查数量精度；补零合法，超精度拒绝。基准数量保持调用方确认值。公开 submit/get 验证 AUX 后续改名、变更精度及停用、产品批准新版本后历史订单不变；新单不能伪造单位事实。共享模型、Hono、运行时输入描述符、持久化和活跃生产者同步修改。
- B2-17：订单必需声明 nullable 收款方式。`CUSTOMER` 精确采用所选客户子单位和批准版本的冻结事实；`CURRENT` 在事务中锁定并核对当前启用方式。两值分别映射为“沿用客户”和“主动改选”。只有客户原快照为空才接受空值；ID、编码、名称和非负两位定点加价均纳入快照核对。候选接口提供客户默认快照和当前方式完整事实，共享草稿描述符同步。订单独立保存五项事实；来源改名、调价、停用后详情与审批不重读来源，价格组合算法未改变。

B2-16 同时修复计量单位删除仅读取无人维护引用缓存的问题：删除事务直接查询 DCL 与 VOU 持久化引用，返回真实结构化 blocker；DCL 采用 AUX 时锁定当前对象，与删除互斥。公开 ArchiveService/AuxService 测试先确认删除错误放行，再验证修复后拒绝且 revision 不变。B2-17 直接查询客户版本和销售订单收款引用，并验证订单反批准、正常删除后解除引用，允许删除仅被该订单采用的方式；不维护第二套引用缓存。

## 资源收尾与审查

本轮独占 Compose project 为 `zerp-issue390`，仅绑定回环端口 55442/18088/18089。启动前确认项目资源不存在，原有共享 `zerp-back-web-1`、`zerp-back-api-1`、`zerp-back-db-1` 保持原状态。完成验证后，读取容器 project 标签和实际镜像 ID，专用 `down --volumes --rmi local` 退出 0；删除本任务失败构建留下的 `46bc014956b0` 容器，退出 0。回读 project 容器、卷、网络和镜像均为空，三个端口均无监听，受控凭证文件已删除。原三个共享服务仍 healthy；初次核验无保留的临时运行资源。后续 VOU 切片另使用专用 `zerp-issue390-vou`；第一片完成后暂保留其数据库供已授权的第二片验证，最终验收统一清理。

本轮新增角色 name collision 用例在真实 HTTP/Service/PostgreSQL 边界核对被拒创建和保存无状态漂移；这是已存在行为的补证，没有为了制造红灯而改变实现。AUX 清理仅收回未被导入的类型导出。最终 API 类型检查、根格式、文档检查（含 6 项检查器测试）和 `git diff --check` 均退出 0。

独立审查采用 Standards/Spec 两轴：发现并修正调用链表中两页 VM 的路径误记；AUX 审计故意失败证据由 `aux-management.int.test.ts` 的 PostgreSQL 22001 拒绝及公开 get 回读断言确认。Standards 无未解决发现；Spec 未发现本轮改动引入的问题。以上为初次核验结论；随后授权修复的验证与审查另列于下文。

## B2-16 修复验证

在专用 `zerp-issue390-vou` PostgreSQL 上，完整 API 集成 55/55（含锁修复后的最终整套回归）、API 单元 46/46、生成器 20/20、Model 33/33 均通过。API、Model、api-client 类型检查通过；前端类型、lint、格式与构建通过。单位快照、真实引用删除 blocker、模型草稿描述符分别有先红后绿证据。Hono 和数据库类型由正式生成入口生成；前端生产页面代码未变。独立审查发现并修复跨产品 advisory 锁与 DCL 配方引用锁顺序可能死锁：VOU 依序持产品稳定对象行共享锁后解析当前版本；DCL 产品批准和反批准持同一行排他锁。真实 PostgreSQL 并发回归通过实际等待状态构造相互竞争，验证订单冻结 V1、产品随后批准 V2，两个事务正常完成。独立 Standards/Spec 复核均无未解决发现。产品不存在时仍由既有领域路径返回业务错误。

## B2-17 修复验证

公开 VOU/AUX Service 的真实 PostgreSQL 回归先红后绿：客户默认采用、当前方式改选、大额定点值、合法空值通过；错误空值、错客户子单位和逐项篡改均拒绝且没有单据落库；当前事实漂移和停用阻止主动改选，客户历史方式停用不阻止继承；保存后的审批和详情保持原快照。真实删除 blocker 分别返回客户版本和订单来源；通过 VOU 反批准、正常删除解除订单引用后，AUX 删除成功。测试中 ACC 余额端口使用零余额固定事实，完整跨域链路另由现有集成和 E2E 验证。Model 34/34、API 单元 47/47 通过。最终完整 API 集成 56/56、生成器 20/20、前端单元 114+10 全部通过；API、Model、api-client 类型检查、前端类型/lint/格式/构建及文档检查通过。生成前后 SHA-256 一致。真实 Chromium 14/14（3.7 分钟）通过，覆盖七页及 Session/导航/角色授权回收；E2E runner 正常退出 0。独立 Standards/Spec 审查均无未解决发现。初次整套集成只有一条旧候选断言漏写新增的 `paymentMethod: null`，按精确契约修正后重新执行完整 56 项通过，未放宽断言。

专用 Compose 的 API/Web 构建、配置校验及三服务健康检查全部退出 0。验证 API 镜像为 `4ac596193b43725576c03ccccdeb99837a9c82f790c280a2183f066500721ac3`，Web 镜像为 `84c51b92bdb3aa6a628a7d8fa62d23d90a42d541481eed10a84fa3733365aa13`；API 容器中六个本片运行时与生成文件的 SHA-256 均与提交候选逐一相等。本片未运行 CI、备份或恢复演练，也未执行远端写入或生产发布。

最终资源回收已完成：`zerp-issue390-vou` 的 `down --volumes --rmi local` 退出 0；回读该 project 的容器、卷、网络、镜像均为空，55442/18088/18089 均无监听。专用凭证文件和网络覆盖文件已删除；原 `zerp-back-web-1`、`zerp-back-api-1`、`zerp-back-db-1` 仍全部 healthy。本次没有保留的临时运行资源。
