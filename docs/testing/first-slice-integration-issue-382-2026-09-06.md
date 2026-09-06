# 2026-09-06 首片集成验收（#382）

## 候选与边界

验收对象是 `codex/378` 的完整集成候选：基线 `7b493650c4b434440dc3505670ad72a2f929f060`，累计包含 #379 `6c3c790e`、#380 `e4cd241f`、#381 `6407b373e2834e09f7cba79de542d72b1c225773` 与本记录同提交的 #382 验收变更。前三票的报告保留为分片证据；本次重新执行完整隔离门禁，不能以分片通过替代集成结果。

本次仅在本地隔离 PostgreSQL/API/Web 执行。合并和生产部署状态单独报告，未执行公网数据转换、生产部署或保护规则变更；本记录不宣称 G01–G08 全域完成。

## 实际装配与契约

真实链路为 `session/vm.ts` 的 Session `apiPaths` → `navigation/resources.ts` 分组去重 → AppLayout 导航 → Router `/:domain/:entity` → ResourceHost → `targetResourceRegistry` 的 `app/user` 登记 → UserManagement → ListPageShell 与公共列表 VM → 用户 VM 的搜索/新建/编辑/启停回调 → `target/api.ts` → Hono 类型客户端 → APP 可执行路由 → ManagementService / SessionService → PostgreSQL。

Session 的七个路径是 `/session/auth/signin`、`/session/auth/restore`、`/session/auth/signout`、`/session/user/get`、`/session/user/save`、`/session/user/change-password`、`/session/app/get`。管理路径为 `/app/user/query|get|create|save|enable|disable`，角色候选来自 `/app/role/query`；独立 `/app/user/reset-password` 业务保留，未增加展示区。用户 wire 身份采用 `id/code/py/name/enabled`，revision 保持字符串；数据库原有物理身份列仍只有一份事实。

## 验收映射

下表中的文件分别位于 `frontend/tests/unit/target/`、`frontend/tests/target-e2e/` 和 `apps/api/tests/integration/`。公开 VM 的可控异步测试与真实 HTTP/PostgreSQL、浏览器各验证其适合观察的边界，未用模拟请求替代真实持久化证据。

| 规格组       | 可复现证据与观察点                                                                                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M01–M03      | `navigation-resources.spec.ts`、`session.vm.spec.ts`、`navigation.spec.ts`：Session 不入菜单、同资源去重、全部授权资源出现、未登记资源明确未实现且没有业务请求。                                          |
| M04–M05      | `app-user.vm.spec.ts`、`router-guards.spec.ts`、`resource-host.component.spec.ts`：create-only 不查询，缺角色依赖不发送请求，无权直达不挂载；浏览器导航测试验证无权直达和已授权未实现资源。               |
| M06–M07、U01 | `app-session-user-query.int.test.ts`、Session/改密 VM 与浏览器 Session 测试：严格拒绝越界字段、本人资料边界、受限会话、Cookie/CSRF、旧会话撤销及恢复。                                                    |
| D01–D02      | `resource-registry.spec.ts`、`app-user-contract.test.ts`、用户 HTTP 测试：固定目标域能力矩阵、用户无审批/业务版本、字符串 revision；真实用户页登记必须存在。                                              |
| L01–L03      | `user.spec.ts`、`app-session-user-query.int.test.ts`、`list-page.vm.spec.ts`、真实 Vuetify 组件测试：菜单进入真实 Shell，完整集合 code/py/name 搜索、20 条稳定分页、改名维护拼音、输入法与 appliedQuery。 |
| L04–L06      | `list-page.vm.spec.ts`、`app-user.vm.spec.ts`、Host 与 Session 测试：乱序/卸载/换用户隔离、同行互斥、revision 冲突不重放、写成功刷新失败保留成功事实并阻止重复创建、未知结果按授权核实且不自动重试。      |
| U02–U03      | `app-user-management.int.test.ts` 与用户浏览器链路：新建/修改/角色分配/启停、授权上限、本人角色与系统身份保护、最后管理员、失败原子回滚、并发一胜一败、停用撤销全部会话、启用不复活。                     |
| S01–S02      | Host/用户/Session VM、真实组件与 `user.spec.ts`、`session.spec.ts`、`navigation.spec.ts`：独立实例和密码清理，桌面/390px 明暗主题的菜单、顶栏、列表、表单、弹窗和反馈。                                   |
| C01          | 生成物测试、Session 旧路径 404、菜单 CLI 与拼音回填集成测试，以及本次基线契约差异和真实路由/导入/数据库核查。                                                                                             |

## 清理与数据核验

从基线和候选生成 OpenAPI 直接比较，删除恰好十个旧路径：`/app/branding/get`、四个 `/app/menu/` 动作 `get/save-business/activate/reset-business`，及 `/app/user/` 的 `change-password/profile/session/signin/signout`；新增恰好七个上述 Session 路径。没有删除其他存续业务 API 隐瞒未迁移资源。

权限目录为 771 条精确权限、87 个静态资源。旧菜单模板 API/权限/展示列/两张模板表/启动同步/编辑页及专属测试已删除。旧用户列表、状态筛选、更新时间、只读详情和 DTO 不在 Router、Registry 或用户调用链中；生成目录与当前数据库类型不含旧菜单结构。迁移脚本和历史验收记录中的旧名称仅用于受控转换与历史证据。

#382 的最终生产引用核查发现旧页面删除后仍遗留不可达的前端适配器。已将 `target/api.ts` 收口到三个真实消费者需要的 Session/品牌/用户动作及角色查询，删除无消费者的其他 APP、DCL、VOU、AUX、BOB、ACC、WFL、RPT 适配器与其两份专属类型测试；保留全部后端业务路由、Service、生成客户端及真实 HTTP 测试。修正 #379 历史报告中把 revision 写成 Session 资料保存输入的表述，严格输入仍只有名称与头像。

`legacy-menu-cleanup.int.test.ts` 在隔离库构造非空旧菜单结构，验证清理、部分基线拒绝、幂等和用户/角色/有效权限/审计保留。`user-pinyin-backfill.int.test.ts` 核对稳定身份、原密码摘要、角色关系、revision 和审计前后不变，错误基线拒绝；本票额外演练真实旧结构没有 `py` 列时的建列、回填、约束与重复执行，独立预期“重庆用户”得到 `chongqingyonghu`。前后摘要一致，只有新拼音事实改变。

恢复依据仍是[菜单结构清理](../operations/menu-structure-cleanup.md)和[拼音回填](../operations/user-pinyin-backfill.md)要求的匹配数据库备份及应用版本；本次没有生产备份/恢复演练或生产数据保留证明，不以隔离库测试冒充生产转换。

## 组件与视觉

复用 AppLayout、288px 侧栏、顶栏、全站 zerpLight/zerpDark 主题、ManagementPageFrame、Vuetify 表格/分页/表单/弹窗、UserEditorPresentation 和 AppSnackbar。Host/Registry 用于授权资源动态装配；从原列表提取的 ListPageShell/VM 用于统一公共查询与写后刷新，现有展示组件原本不拥有此行为边界。本票不新增组件或组件库。

对照改造前 `.scratch/frontend-restoration/visual/desktop-app-user-list.png`、`narrow-app-user-list.png` 和 #379/#380 的主题与导航截图，核对本次生成的桌面及 390px 明暗列表、编辑器、侧栏、顶栏、资料与空密码弹窗。保留蓝色主按钮、原字体、卡片间距、状态标签、分组图标与窄屏表格横向滚动提示；按规格删除旧筛选与列。截图只在密码为空或不存在时采集，测试数据及截图不提交。

浏览器执行配置另关闭 Playwright 失败时自动附加的页面快照；手动视觉截图仍只发生在敏感字段不存在或为空时。新增受限身份通过现有 Bootstrap Service 在隔离库授予唯一 `/app/user/create`，只向浏览器进程传递随机凭证，不输出凭证或请求体。测试创建用户的清理包括其自助操作产生的审计引用，避免清理被外键阻断。

## 集成发现与修复

新增真实本人改名链路首次运行失败：资料弹窗在详情加载完成前允许输入，迟到详情覆盖输入后仍保存旧名称。先以可控详情 Promise 的公开组件测试复现失败，再用 `profileLoading` 锁定名称、头像和保存；保存期间同样锁定可变字段。关闭、退出和换会话继续清除状态并使旧响应失效。加载期与保存期回归都通过。

首次专项浏览器运行另有两项：create-only 的断言错误期待无权保存按钮被禁用，实际按现有产品行为隐藏，已修正测试；新用户自助操作产生审计后，测试清理遭外键拒绝，已在原隔离测试清理事务中先删除这些测试主体的审计，再删除主体。该清理仅用于可丢弃 E2E 数据，生产审计规则没有改变。初次专项只有分页通过，未把它报告成完整成功。

## 最终验证与资源回收

完整 `make target-e2e` 执行了当前候选的生成一致性、权限目录/RPT 校验、WFL Node/browser parity、各包类型检查、前端 lint/format/build、共享模型 33 项、前端公开 VM/组件 63 项与真实 Vuetify 10 项、API 单元 39 项、生成物 20 项及真实 PostgreSQL 集成 41 项，全部通过。

该次命令的浏览器阶段为 7/8：视觉测试仍等待固定测试账号在第一页，而新建的 21 条分页数据已把该账号排到后页。只将等待条件改为实际列表行加载，未改变业务代码或旧行为；随后通过同一隔离 API/Web 重新执行完整 `pnpm --filter @zerp/api e2e`，8/8 通过，命令退出码 0，清理也成功。生成/类型/构建/单元/数据库等证据仍覆盖未变更的实现，予以复用；没有把前一次 `make target-e2e` 的退出码写成 0。最终浏览器文件的前端 lint/format 检查再次通过。

`make check-common check-ci-workflow` 通过，覆盖文档、格式、diff 与 15 项 CI 行为测试；文档收尾后再次执行公共检查。Compose 配置校验通过，回读 `/healthz` 与 `/readyz` 均为 `ok`。测试清理后的只读数据库核验：测试用户剩余 0、旧菜单表 0、`app_users.py` 为 NOT NULL。

本次启动的 `zerp-target` PostgreSQL/API/Web 已用 `make target-down` 显式关闭并删除隔离卷与网络；按 Compose project label 回读无剩余容器、卷或网络，55439/18082/18083 无监听。浏览器上下文在测试 finally 中关闭，Playwright 进程随成功命令退出。会话开始前已有的 `zerp-back` 三个共享服务仍保留，未停止或修改；本次无需保留任何运行资源。

### Standards

独立标准审查及最终复核无剩余发现。已清理真实入口不可达的前端适配器和专属测试，未删除存续后端 API；资料加载修复保持既有组件和请求代次边界。

### Spec

独立规格审查与主会话最终复核无剩余首片发现。M01–M07、D01–D02、L01–L06、U01–U03、S01–S02、C01 的证据见上表及本次完整浏览器结果。未执行生产数据转换、生产备份恢复、公网部署、远端 PR required checks 或合并；后续全域验收不计为已完成。

## 尚未迁移

实际页面仅登记 `app/user`。其余 86 个静态资源均保留授权入口与未实现提示：APP 3 个（permission、role、system-parameter），AUX 13 个，BOB 11 个，DCL 13 个，VOU 38 个，ACC 5 个，RPT directory 1 个，WFL 2 个；动态 RPT 资源按实际授权出现，同样尚未登记业务页。

DCL 稳定身份和版本写入仍遵循 ADR-0046/0047；ACC 期初仍有审批，配置资料历史迁移尚未执行。ADR-0052 的目标域矩阵不改变这些现行事实。DCL→BOB、ACC 期初→VOU、配置资料归属与其他页面迁移仍需后续切片，不能据本次首片验收宣称全域完成。
