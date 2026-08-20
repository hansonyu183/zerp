# 页面用例

本目录按用户可见页面记录前端编排、后端协作次序、异常分支和验收场景。业务规则仍以 [`docs/domains/`](../domains/) 为唯一事实来源，HTTP 路径和数据结构仍以 [`contracts/openapi/`](../../contracts/openapi/) 为唯一事实来源。

用例文档遵循以下边界：

- 一个页面一份文档；跨页面流程归入用户发起或主要感知该流程的页面；
- 只描述触发条件、前端状态与跳转、调用顺序、后端协作和可观察结果；
- 通过链接引用领域不变量、状态转换、权限和事务规则，不复制其正文；
- 通过链接引用 OpenAPI，不维护请求或响应结构副本；
- 全站通用交互规范写入 [`frontend/AGENTS.md`](../../frontend/AGENTS.md)，页面文档只记录有业务含义的例外。

全站列表、详情和引用候选的读取边界见 [`frontend/AGENTS.md`](../../frontend/AGENTS.md)。前端页面及用例的双向覆盖清单见自动生成的 [`COVERAGE.md`](COVERAGE.md)；新增、删除或重命名页面或用例后运行 `pnpm docs:coverage`。缺失用例在覆盖清单中统一跟踪；`pnpm docs:check` 会拒绝孤儿用例或覆盖文件漂移。
