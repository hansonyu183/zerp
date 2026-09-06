# 2026-09-06 Session 契约切换验收（#379）

本记录对应 #378 集成分支的第一片 #379，不代表生产发布或后续导航、管理页面迁移完成。

## 实现范围

- 切换七个可执行端点：`/session/auth/signin`、`restore`、`signout`，`/session/user/get`、`save`、`change-password`，以及 `/session/app/get`；删除对应旧 APP 自助端点及消费者，不保留兼容入口。
- 登录使用 `code/password`；启动上下文返回 `user{id,code,name}`、`apiPaths`、CSRF 与密码策略。头像通过自助资料接口加载，资料保存只接受名称与头像，不接受客户端 revision（本项在 #382 核对严格契约后纠正）。
- 保留用户稳定 ID、既有数据库字段、密码与角色关系；未执行生产数据迁移。
- 复用现有登录页、强制改密页、AppLayout、Vuetify 对话框与主题控制。补齐异步恢复、退出、资料读写和改密竞态保护，以及密码字段关闭清理。
- 现有菜单与管理页面保留，后续按 #378 和 ADR-0052 的切片实施。

## 验证

- `make target-e2e`：生成检查、类型检查、格式与静态检查、构建、共享模型、前端、API、真实 PostgreSQL、WFL Node/browser parity 和浏览器端到端验证。
- 结果：共享模型 33、前端单元 188、组件 9、API 单元 38、生成物 20、PostgreSQL 集成 30 全部通过；WFL parity 通过。全量浏览器运行 50 通过、1 既有跳过、1 截图等待超时；将等待条件限定为有限动画后，Session 专项重跑 1/1 通过。复用其余未变更场景的通过证据，未将首次全量命令报告为成功。
- `make check-common check-ci-workflow`、最终前端类型与静态检查、`git diff --check` 通过。桌面与窄屏资料、空密码对话框及深色布局截图已人工核对。
- Session 回归覆盖旧端点不可达、严格字段校验、资料 revision 冲突、密码及会话行为、typed client 消费、敏感输入清理和异步结果失效。
- 浏览器覆盖 1280×800、390×844 的资料读取与保存、主题切换、改密取消与重开、退出登录。截图只在密码为空时采集。
- 前后端独立审查完成，修复已确认问题后无遗留 Standards/Spec finding。
- 保留原有 VOU 中介核算 `test.fixme`；该场景不属于本片，不计为通过。

本地使用 Go 1.26.6。Colima 构建 DNS 故障通过临时 Compose build host 映射解决，未修改项目运行配置；临时映射在验收后删除。
