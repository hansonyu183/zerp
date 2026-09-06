# 动态导航 Host 用例

## 范围

- 唯一业务资源路由为 `/:domain/:entity`，由 `app/navigation` 登记并由动态 Resource Host 承载。
- Navigation Resource 和 Navigation Entry 的来源、权限边界及未实现语义以 [APP 导航资源](../../domains/app.md#39-导航资源) 和 [ADR-0052](../../adr/0052-session-dynamic-navigation-and-page-migration.md) 为准。
- 本票 Registry 刻意为空；所有非 Session 资源，包括 `app/user`，都只显示尚未实现。资源既有 API 及领域规则继续由各自领域文档拥有。

## `APP-NAVIGATION-01` 从会话装配入口

1. 登录或恢复成功后，页面从唯一 Session Context 的 `apiPaths` 取出非 Session 精确路径，按 `domain/entity` 去重并按领域分组。
2. 同一资源只显示一个 Navigation Entry；任一动作路径足以使入口可见，不能要求 `query` 或与页面 Registry 求交集。
3. 已知资源使用统一中文名称；未知遗留资源显示资源标识及待配置说明，不隐藏或猜测其业务能力。
4. Session 刷新得到新权限后，导航与直达资格同步重算；被撤销的资源入口和已挂载页面一并移除。

## `APP-NAVIGATION-02` 进入资源

1. 使用者从入口或直达 `/:domain/:entity` 进入时，Host 先用同一 Navigation Resource 判定资格。
2. 没有该资源时进入无权访问反馈，不挂载业务功能，也不发起业务请求。
3. 有资源且已登记时，Host 创建该资源的一次独立页面实例；页面自身只调用精确动作路径。
4. 有资源但未登记时，Host 显示明确的尚未实现反馈，不发送查询、不伪造空列表，也不回退旧页面。

## 验收

1. `session` 路径不产生导航入口；同资源多动作去重；仅有 `create` 的资源仍可进入但不查询。
2. 菜单、直达 URL 和权限变化使用同一资源资格；旧菜单树、菜单 API、`query` 过滤、前缀匹配和页面登记均不能改变入口资格。
3. 本票的空 Registry 下，`app/user` 和其他已授权资源都如实显示尚未实现；下一票登记用户页面前，不得声称旧用户管理页面仍然可用。
