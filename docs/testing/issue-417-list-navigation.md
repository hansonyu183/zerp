# #417 列表与导航验收

2026-09-10 完成本片。实现候选 SHA：`a5636324433382d25860f16c6f7dbdc592832ad7`，分支 `feat/417-unified-lists-navigation`。本记录的后续提交只补充验收文档与用例链接，复用该候选的实现验证结果。

范围依据 [#417](https://github.com/hansonyu183/zerp/issues/417)、[ADR-0060](../adr/0060-dynamic-page-runtime.md) 和[公共列表与导航](../use-cases/list-navigation.md)。未执行生产变更或远端发布。

## 实现与回归

六类页面的普通列表共用 DynamicCols 与 RowActions，分页显式区分 total 和 hasMore。版本正式资料、提交记录、单据、映射和流程保持各自真实行标识；报表采用本页 displayKey，保留列宽、可见列、值解释及导出语义。报表空字符串与 null 的实际页面回归先失败、修复后通过，列专用空文本提示同时受类型与运行时边界限制。

ListPageShell 仅接展示数据、筛选输入和事件，直接维护页持有引用加载、删除确认、反馈与写入生命周期。Registry 必须登记 definition，ResourceHost 按六类 kind 选择页面；根文档覆盖检查同步删除旧 component 要求。原组件错配接口和普通重复表格已删除。

导航呈现层准备有限领域与资源图标，动态菜单通过条目 icon 接收，未知项保留文本和路由。固定行操作、账户及导航控件使用语义映射，图标不推断权限。测试经过真实 Session 资源组、AppLayout、Host 与 API 请求，保留无查询权限、仅导出、查询快照、乱序响应、权限撤销、Session 切换、取消与写后刷新、未知结果锁的回归覆盖。

## 命令与结果

所有 Compose 命令均使用 `TARGET_COMPOSE='docker compose -p zerp-417 -f compose.target.yaml'`。受控环境注入独占端口 PostgreSQL 55617、API 18418、Web 18419，浏览器 API 地址和 CORS 与该环境一致；未访问公网业务数据库。

| 命令                                        | 退出码 | 结果                                                                                                          |
| ------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @zerp/frontend typecheck`    | 0      | 最终候选与类型反例通过                                                                                        |
| `pnpm --filter @zerp/frontend lint`         | 0      | 通过                                                                                                          |
| `pnpm --filter @zerp/frontend format:check` | 0      | 通过                                                                                                          |
| `pnpm --filter @zerp/frontend test:unit`    | 0      | 常规 244 项、真实 Vuetify 21 项通过                                                                           |
| `pnpm --filter @zerp/frontend build:target` | 0      | SPA 构建通过                                                                                                  |
| `make check-common`                         | 0      | 格式、文档检查及脚本回归、差异检查通过                                                                        |
| `make --silent check-ci-workflow`           | 0      | 工作流检查通过                                                                                                |
| `make --silent target-e2e`                  | 2      | 生成一致性、WFL parity、模型/API 检查与真实 PostgreSQL 测试通过；首轮通用浏览器组 25 通过、3 失败，见下文修正 |
| `make --silent target-db`                   | 0      | 重跑前重置独占数据库                                                                                          |
| `make --silent -o target-test target-e2e`   | 0      | 最终完整浏览器段 99 项通过，按原 Makefile 依次运行并重置各专项环境                                            |
| `make --silent target-down`                 | 0      | 独占容器、卷及网络回收                                                                                        |

首轮通用浏览器组的两项 AUX 失败依赖旧分页容器的直接子元素层级，已改为查询可见总数；一项其他单位测试在查询返回前点击旧提交记录，已等待与关键词匹配的真实查询响应。重跑前还根据截图修复标题按钮裁切与 tooltip 对比，并完成最终前端类型检查、lint/format、单元测试和构建。

`-o target-test` 只复用此前已通过且未受后续前端调整影响的生成、WFL parity、模型和后端证据；最终前端检查另行完整执行。模型 37 项、API 单元 85 项、生成物 19 项、真实集成 113 项及迁移专项均通过。浏览器最终结果：通用 28、WFL 1、单据目录 2、会计期初 2、逐类录入 66，共 99 项；覆盖全部 32 类人工录入单据的菜单、候选、提交、持久化回读及克隆。原始命令日志保留于本地 `.scratch/issue-417/`。

## 窄屏与主题

最终导航专项在 1280px/390px、浅色/深色主题生成 8 张 Host 与导航截图，位于本地 `.scratch/issue-417/{1280,390}-{light,dark}-{host,navigation}.png`。人工检查最终 390px 两种主题 Host、1280px 深色导航和 390px 深色导航：中文与图标可读，标题动作换行后完整可见，表格保留自身横向滚动，tooltip 使用主题表面色后可读。

真实浏览器额外断言新增客户、正式资料、提交记录按钮完整位于视口，导航及主题图标存在，导航 tooltip 支持键盘聚焦，装饰图标不重复朗读；列表行操作在各业务窄屏场景中完成实际点击与请求。截图和测试数据不提交。

## Standards

独立审查发现 tooltip 默认插槽替代了 Vuetify 图标按钮的自动图标，已显式保留 VIcon 并增加浏览器断言。最终增量审查无遗留问题。

## Spec

独立审查发现报表空字符串被公共文本占位符改写，已通过真实页面失败测试修复。后续列专用配置类型边界同步收紧；最终无遗留行为问题。

Standards：0 项遗留；Spec：0 项遗留。

## 收尾

关闭前确认三个独占服务均健康；关闭后回读确认 `zerp-417` 容器、卷和网络均不存在，并删除临时凭证环境文件。测试运行器结束并关闭浏览器及数据库连接，未保留本票临时服务。原有共享环境未关闭。原有文档修改与开始时的差异逐项核对一致，未混入实现提交；原有未跟踪文档保留。
