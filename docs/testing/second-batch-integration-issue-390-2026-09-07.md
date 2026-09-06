# 第二批集成验收 #390（2026-09-07）

## 候选与结论

本轮验收基线为 `ffb607464d7c667f16b7f104c8c095335d2ba2c6`，沿用 `codex/issue-386-aux-management` 集成分支。该 SHA 已包含 #385–#389 的本地实现；GitHub 前序票仍为 open，不能据提交消息推导已合并或已发布。本轮补证和死导出清理提交为 `0dade63ce584204a67120b8d3d00bf53d22461fb`，最终测试候选对应该提交内容；容器行为验证复用未改变的运行时实现。本文逐项核对父 Issue #384 的 B2-01 至 B2-26，记录当前证据及真实缺口，不替代领域规则。

目前 B2-16、B2-17 尚未全部满足：页面、AUX 协议和产品/客户历史快照已有实际验证，但 VOU 交易单位精度/完整审计快照及销售订单收款方式快照存在实现漂移。因此不能宣称 #390 或整批验收完成。没有改写父 Issue、关闭前序票、推送、合并或生产上线。

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

相对第二批基线 `58bee225`，实际 SQL 变化来自 #389：`vou_asset_acquisition_line_snapshots` 增加 `category_default_useful_life_months` 和 `category_default_residual_rate_hundredths` 两个快照列及简单范围 CHECK。本轮尚无新增 SQL 变化。公共启停及拼音没有引入表、函数、存储过程或触发器。

## B2 验收矩阵

下表的测试文件为本轮实际运行的候选测试；失败或待执行项不计为通过。历史报告仅提供前序红绿过程和设计边界，当前通过结果以本轮命令为准。

| ID    | 覆盖票         | 实际证据                                                                                                         | 结果   |
| ----- | -------------- | ---------------------------------------------------------------------------------------------------------------- | ------ |
| B2-01 | #385–#389      | Registry 静态七项；七页 E2E 从菜单进入真实 Shell/编辑器                                                          | 通过   |
| B2-02 | #385/#390      | navigation E2E；navigation-resources、Host VM/component；单项非 query 角色 E2E                                   | 通过   |
| B2-03 | #385/#386      | 三个真实 Service 消费共同 `changeEnablement`；APP/AUX PostgreSQL 启停测试                                        | 通过   |
| B2-04 | #385/#386      | app-user-management、aux-management 的同 revision 并发唯一赢家、陈旧和同态拒绝                                   | 通过   |
| B2-05 | #385/#386      | APP/AUX 真实大整数 CAS；app-role-contract、aux-contract 拒绝数字并精确保留字符串                                 | 通过   |
| B2-06 | #385           | app-user-management 的 disable revokes every target session、enable does not revive；用户浏览器自助流程          | 通过   |
| B2-07 | #385           | role enablement keeps user role references and sessions；真实旧会话请求拒绝 E2E                                  | 通过   |
| B2-08 | #385/#390      | system/self/ceiling/final administrator 真实事务；本轮补名称 trim/大小写冲突与 superadmin 拒绝                   | 通过   |
| B2-09 | #385           | app-user VM 的全部候选页与停用关联合并；真实 HTTP assignable roles；用户编辑器角色分配 E2E                       | 通过   |
| B2-10 | #385           | role create/save exact write permission；停用权限显式移除；角色 VM 分页目录与依赖权限                            | 通过   |
| B2-11 | #385/#390      | user E2E 创建单项角色→分配用户→恢复 Session→无 query→停用后旧请求拒绝→菜单撤销                                   | 通过   |
| B2-12 | #385/#386      | role/AUX Hono 契约测试及真实 HTTP 原生列表                                                                       | 通过   |
| B2-13 | #385–#389      | app-user-management/aux-management 匹配后分页；七页真实名称/编码/拼音查询及 >20 条数据                           | 通过   |
| B2-14 | #386           | 十二实体共享 Hono 工厂和 literal routes；aux-contract 全实体协议覆盖                                             | 通过   |
| B2-15 | #385/#386      | 原生创建/改名；AUX PostgreSQL current name 查询；strict 输入拒绝 code；事务失败回滚                              | 通过   |
| B2-16 | #387/#390      | measurement-unit 契约/VM/E2E 边界；archive-lifecycle 历史产品单位快照不变；VOU 未按产品精度校验/冻结完整单位事实 | 未通过 |
| B2-17 | #388/#390      | payment-method 契约/VM/E2E 大额定点与非法输入；archive-lifecycle 客户旧快照不变；VOU 缺最终收款快照              | 未通过 |
| B2-18 | #389           | asset-category E2E 合法端点/非法字段；acc-core 购置采用快照及台账历史不变                                        | 通过   |
| B2-19 | #386–#389      | aux-management 引用 blocker；archive-lifecycle 新采用拒绝及历史读取；acc-core 类别新采用拒绝                     | 通过   |
| B2-20 | #385–#389      | 公共 list VM 可控 Promise；user/role/AUX VM；Host dispose/Session generation 组件测试                            | 通过   |
| B2-21 | #385–#389      | VM 写成功刷新失败、取消、未知结果锁定不重放；专有 AUX E2E 故障反馈                                               | 通过   |
| B2-22 | #385/#386      | platform/pinyin 纯工具及 APP/AUX 查询顺序；真实拼音分页测试                                                      | 通过   |
| B2-23 | #385–#389      | 七页 desktop/390px E2E；岗位移动编辑器/人员类别桌面截图人工复核                                                  | 通过   |
| B2-24 | #385–#390      | 严格旧输入拒绝；入口/导入/调用链核查；删除 AuxData 死导出；未迁移范围如实列明                                    | 通过   |
| B2-25 | #385/#386/#389 | APP/AUX 审计故意失败 PostgreSQL 回滚；ACC/VOU 类别候选失败无部分写入                                             | 通过   |
| B2-26 | #390           | 独占 Compose 与回环端口；未运行备份/恢复/CI；保留共享服务                                                        | 通过   |

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

## 待定的 VOU 修复范围

- B2-16：现行 AUX 3.5 与 VOU 规则要求按采用产品版本的 quantityScale 校验数量并保留历史单位事实。当前 `VouProductLineInput.product/enteredUnit` 为 objectId，提交未解析所采用产品的 unit_conversions，按统一六位小数持久化，详情只读回单位 ID。产品历史快照测试通过不能替代该交易链路。
- B2-17：现行 AUX 3.4、BOB 收款快照与 VOU 规则要求订单保存最终收款方式和销售加价。Customer payment_snapshot 已存在，但 sale-order 当前共享模型、Hono、schema 和 Service 没有对应最终字段。客户历史快照测试通过不能证明订单已采用或支持显式重新选择。

两项需要明确 VOU 契约、快照持久化和活跃消费者的完整切片，不能靠兼容字段、回查 current、放宽权威规则或只补绿色断言消除。

## 资源收尾与审查

本轮独占 Compose project 为 `zerp-issue390`，仅绑定回环端口 55442/18088/18089。启动前确认项目资源不存在，原有共享 `zerp-back-web-1`、`zerp-back-api-1`、`zerp-back-db-1` 保持原状态。完成验证后，读取容器 project 标签和实际镜像 ID，专用 `down --volumes --rmi local` 退出 0；删除本任务失败构建留下的 `46bc014956b0` 容器，退出 0。回读 project 容器、卷、网络和镜像均为空，三个端口均无监听，受控凭证文件已删除。原三个共享服务仍 healthy；本轮无保留的临时运行资源。

本轮新增角色 name collision 用例在真实 HTTP/Service/PostgreSQL 边界核对被拒创建和保存无状态漂移；这是已存在行为的补证，没有为了制造红灯而改变实现。AUX 清理仅收回未被导入的类型导出。最终 API 类型检查、根格式、文档检查（含 6 项检查器测试）和 `git diff --check` 均退出 0。

独立审查采用 Standards/Spec 两轴：发现并修正调用链表中两页 VM 的路径误记；AUX 审计故意失败证据由 `aux-management.int.test.ts` 的 PostgreSQL 22001 拒绝及公开 get 回读断言确认。Standards 无未解决发现；Spec 未发现本轮改动引入的问题。B2-16/17 为明确保留的规格缺口，未被其他通过结果覆盖。
