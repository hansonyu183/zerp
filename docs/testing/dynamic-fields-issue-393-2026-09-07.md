# 动态字段与七页切换 #393（2026-09-07）

## 范围与入口

基线为 `67b8330cbc52c073ac176166d07d8aa2e786a3b4`，实现位于 `codex/issue-393-dynamic-fields`。本票只完成七个既有资料页的字段切换与查询状态修正，不表示 #392 的领域迁移、VOU 页面或临时表单全批迁移已经完成；未修改 CI、推送、合并或生产部署。

真实调用链为 Session → 菜单 → `ResourceHost` → Registry 的 `definition` → 七页各自 VM/专有编辑器 → `ListPageShell` → `DynamicForm`、`DynamicCols`、`RowActions` → 类型化 API。七页为 app/user、app/role、aux/employee-category、aux/position、aux/measurement-unit、aux/payment-method、aux/asset-category。

`defineListPage` 的类型与运行时登记要求 id/code/py/name/enabled、keyword，以及 code、name、enabled、唯一末尾操作列。隐藏 py 不免除行校验。删除旧固定关键词、基础列模板及七页重复 Shell 事件转发和行类型强转，保留各专有编辑器。

计量单位的已有 symbol、quantityScale 进入扩展列；quantityScale 进入明确的 Hono/Zod 查询输入并在服务端与 keyword AND 后计数分页。0 是有效筛选，清空在页面 API 绑定中映射为省略；其他六页不接受该字段。不改数据库 schema、历史数据或持久化写入路径，OpenAPI 从可执行路由生成。

角色类型 NORMAL/SYSTEM/SUPERADMIN 的普通角色/系统角色/超级管理员映射由角色列表和用户角色选择共同消费。有限字段协议另覆盖 decimal、date/range、boolean、enum 和受控 reference；当前唯一 reference source 为 app/role，按精确读取权限分页加载，七页不人为增加不存在的引用筛选。

## 验证结果

| 边界               | 本次结果                                                                                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 字段与资料登记     | 公共函数/组件接受与拒绝测试、静态负向类型检查通过；覆盖必需字段、顺序、重复键/身份、非法类型/range/source/回调、未知 enum、安全整数、大额 decimal/尾零/超精度、范围、空值/0/false、安全文本与引用摘要 |
| 公共 VM            | 完整 filterInput/appliedQuery 深复制、分页/刷新快照、乱序/dispose、changed 一次刷新、取消无刷新、已知冲突刷新解锁、未知写入普通查询不解锁通过                                                         |
| 七页 Host 与编辑器 | 实际 Registry/Host/页面 VM 挂载测试通过；初始请求一次、保留各编辑器、取消不刷新、非 query 权限不读取、quantityScale=0 到 API                                                                          |
| 前端单元与组件     | 两套现有 Vitest 配置，共 150 项通过                                                                                                                                                                   |
| API 单元与生成脚本 | 48 项 API 单元及生成脚本测试通过；生成物再次生成哈希一致                                                                                                                                              |
| PostgreSQL 集成    | 全部 57 项通过，含 quantityScale=0、AND、多页 total=21 与 20+1 分页                                                                                                                                   |
| Chromium 真实链路  | 六个现有测试文件共 13 项通过；七页桌面/390px 查询、编辑、启停、部分权限与会话撤销；页面无横向整体溢出                                                                                                 |
| 静态与构建         | frontend/API/api-client/model 类型检查、前端 lint/format、根 format、docs/ADR 索引、diff 检查和 SPA 构建通过                                                                                          |
| 独立审查           | Standards 0 个明确问题，Spec 0 个明确问题；最终角色中文映射去重另通过 17 项用户/七页 Host 回归、类型检查与构建，复用行为不变的浏览器证据                                                              |

浏览器首次运行的计量单位新增断言遗漏桌面编辑对手机阶段数据的影响：一条 quantityScale 从 0 改成 6 后，手机阶段应为 20 条精度 0 和 2 条精度 6。修正独立预期后，整套 13 项复跑通过。

## 可复现分项入口

数据库和 API/Web 地址通过进程环境传入现有 target 测试命令；凭证不写入本文。未调用会经 target-db 隐式执行 down/清库的 make generate/check/test/e2e。

```sh
pnpm --filter @zerp/api generate:artifacts
pnpm --filter @zerp/api sync:catalog
pnpm --filter @zerp/api test:unit
pnpm --filter @zerp/api test:artifacts
pnpm --filter @zerp/api test:integration
pnpm --filter @zerp/frontend test:unit
pnpm --filter @zerp/frontend typecheck
pnpm --filter @zerp/api typecheck
pnpm --filter @zerp/api-client typecheck
pnpm --filter @zerp/model typecheck
pnpm --filter @zerp/frontend lint
pnpm --filter @zerp/frontend format:check
pnpm --filter @zerp/frontend build:target
pnpm docs:adr-index
pnpm docs:check
pnpm format:check
pnpm --filter @zerp/api e2e -- navigation.spec.ts user.spec.ts aux.spec.ts measurement-unit.spec.ts payment-method.spec.ts asset-category.spec.ts
```

仅使用仓库现有 compose.target.yaml 分项启动测试服务；未改编排、重置整库或重建隔离方案。任务开始时的 zerp-back 共享容器保持运行；本任务启动的 target 容器、网络与专属临时卷在验证后回收，未终止共享服务。
