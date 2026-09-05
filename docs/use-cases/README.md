# 页面用例

本目录按用户可见的 target 页面记录前端编排、后端协作次序、异常分支和验收场景。业务规则仍以 [`docs/domains/`](../domains/) 为唯一事实来源；HTTP 路径和数据结构从 `apps/api/` 的可执行 Hono/Zod 路由生成。

用例文档只描述触发条件、前端状态与跳转、调用顺序、后端协作和可观察结果；通过链接引用领域不变量、状态转换、权限和事务规则，不复制其正文。前端页面及用例的双向覆盖清单见自动生成的 [`COVERAGE.md`](COVERAGE.md)：它以 `frontend/src/target/router/index.ts` 中每个带 `meta.title` 的正式路由及其 `meta.useCaseKey` 为唯一页面来源。新增、删除或重命名页面或用例后运行 `pnpm docs:coverage`。
