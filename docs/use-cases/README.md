# 页面用例

本目录按当前用户可见的 target 页面记录前端编排、后端协作次序、异常分支和验收场景。业务规则仍以 [`docs/domains/`](../domains/) 为唯一事实来源；HTTP 路径和数据结构从 `apps/api/` 的可执行 Hono/Zod 路由生成。未在动态 Resource Host Registry 登记的资源没有页面用例；它们的既有服务语义只在对应领域文档中维护。

用例文档只描述触发条件、前端状态与跳转、调用顺序、后端协作和可观察结果；通过链接引用领域不变量、状态转换、权限和事务规则，不复制其正文。前端页面及用例的双向覆盖清单见自动生成的 [`COVERAGE.md`](COVERAGE.md)：它同时读取 `frontend/src/target/router/index.ts` 中带 `meta.title` 的正式路由及其 `meta.useCaseKey`，以及 `frontend/src/target/navigation/registry.ts` 显式登记的资源用例。Host 路由对应 `app/navigation`，资源用例按 Registry 登记；共用直接维护交互见 [APP 用户与角色](app/access-management.md#app-direct-01-统一直接维护)，资源特有场景按少量页面家族归整，不能用已删除资源页用例伪装当前 Registry 状态。新增、删除或重命名页面或用例后运行 `pnpm docs:coverage`。

全部正式 Registry 登记必须声明 `useCaseKey`，省略也计入分母并失败；资源标识唯一，多个入口可以共享有实际场景覆盖的用例。入口数量与唯一用例数量分别报告，VOU/RPT 动态家族不展开参数。覆盖检查采用严格零缺失规则。前端和 API 模块不得复制领域文档。
