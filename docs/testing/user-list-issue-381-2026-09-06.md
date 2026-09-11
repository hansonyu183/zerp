# 2026-09-06 公共列表与用户管理验收（#381）

本记录对应 `codex/378` 隔离集成分支的第三片 #381，基线为 `e4cd241f`（#380）。各片在该分支累计验证，本票不代表整合主分支、生产发布或全域迁移。

## 交付链路与组件

链路为 Session `apiPaths` → AppLayout 动态菜单 → ResourceHost → Registry 的 `app/user` 登记 → 用户页面 → ListPageShell / 公共列表 VM → 用户业务回调 → 类型化 API → Hono → ManagementService → PostgreSQL。

复用现有 ManagementPageFrame、Vuetify 表格与分页、UserEditorPresentation 弹窗表单、AppSnackbar、侧栏、顶栏和 zerpLight/zerpDark 主题。将保留的 UserListPresentation 提取为公共 ListPageShell，公共 VM 唯一维护查询、分页、异步代次和行级等待；用户 VM 只维护编辑器及用户业务动作。新增公共 Shell/VM 是因为现有展示组件没有可复用的查询与写后刷新边界，不引入第二套组件库、通用列配置或全局编辑器。

删除被替代的用户专属列表展示与专属旧断言。旧状态筛选、更新时间、只读详情、密码重置展示和旧 DTO 不进入新链路。其他资源不回退旧页面，仍保留真实 API、权限和明确未实现提示。

## 契约与事实

用户管理原有路径直接切换：`/app/user/query`、`/app/user/get`、`/app/user/create`、`/app/user/save`、`/app/user/enable`、`/app/user/disable`。独立 `/app/user/reset-password` 保留其业务边界，其请求 revision 同步为字符串，响应仍仅返回一次临时密码；本票没有重置密码展示区。

Session 继续使用 #379 的 `/session/auth/signin`、`/session/auth/restore`、`/session/auth/signout`、`/session/user/get`、`/session/user/save`、`/session/user/change-password`、`/session/app/get`。本票只让本人改名与管理改名共同维护真实拼音，不新增 Session 别名。

用户事实采用 id/code/py/name/enabled，revision 始终保持字符串。查询针对完整服务端集合进行编码、拼音、名称 OR 包含匹配，并按编码与 ID 稳定分页。服务端用 `pinyin-pro` 统一生成小写无声调拼音，现有物理列只保存单一事实；[受控回填](https://github.com/hansonyu183/zerp/blob/c9c2d8fca30d9da7b4046315733b7666d564b0d5/docs/operations/user-pinyin-backfill.md) 显式执行并校验既有身份、密码、关联与审计，没有请求期回填、空拼音默认值或双写。

核查并修正既有角色分配漂移：角色定义可维护性与用户角色可分配性分开，启用普通角色按授权上限分配（包括操作者已持有角色），超级管理员角色仅由当前启用超级管理员授予，停用角色和系统角色不可分配；角色定义的本人保护未放宽。

用户已知启用值使用“启用/停用”，服务端 VIEW/EDIT/ENABLE/DISABLE 动作资格与既有角色状态/类型使用对应中文映射；页面只按精确授权、角色 assignable 与对象资格呈现操作，执行仍由服务在事务内重新验证。

## 验证

采用公共 VM、真实 HTTP/PostgreSQL 与真实浏览器三个接缝验收。公共 VM 覆盖服务端分页、旧响应失效、写入互斥、取消与保存承诺、权限缺失、角色完整分页、停用关联展示、字符串 revision 冲突、未知写入结果核验及会话退出后的迟到响应。HTTP 集成覆盖权限上限与原子回滚、本人保护、系统角色、管理员不变量、双 Session 停用撤销、重新启用、并发冲突、审计、拼音查询和角色可分配性。回填测试验证原有身份、密码哈希、角色关联与审计保持不变及错误基线拒绝。

真实浏览器覆盖动态菜单进入、新增、改名后拼音查询、停用与启用，以及 1280px / 390px 的明暗主题列表与编辑器。浏览器验收发现编辑详情加载时提前输入可能被返回值覆盖，已先用组件测试复现失败，再禁用加载中的可变控件并验证通过。保存期间同样锁定输入与取消。用户创建场景的清理先删除全部测试主体创建的用户，再删除各主体角色，避免跨主体角色引用阻塞清理。

最终 `make target-e2e` 退出码为 0：模型 33 项、前端公共 VM/组件 63 项及真实 Vuetify 8 项、API 单元 39 项、生成物 20 项、真实 PostgreSQL 集成 41 项、目标浏览器 6 项全部通过；WFL Node/浏览器一致性检查、生成物一致性、各包类型检查、前端 lint/format/build 同时通过。`make check-common` 通过，Compose 配置校验和 API `/healthz`、`/readyz` 均成功。

已查看桌面与 390px 明暗主题的列表/编辑器共 8 张截图：沿用全站窄屏表格横向滚动提示，查询区与弹窗操作在视口内可用。截图位于本地忽略目录 `.scratch/issue-381-user/`，未提交测试账号或运行数据。

本地 Docker 构建首次遇到 npm 域名 DNS `EAI_AGAIN`，最终验证通过临时 Compose build `extra_hosts` 指向公开 registry 地址完成；没有修改仓库网络配置。验收后删除临时覆盖文件并关闭本会话的 `zerp-target` 环境，已有共享环境不受影响。

Standards 与 Spec 独立审查发现的问题均已修复，最终复核无未解决实现问题。

## 未迁移范围

只有 `app/user` 登记真实业务页。APP 的其他资源及 AUX、BOB、DCL、VOU、ACC、RPT、WFL 未登记页面仍显示未实现。DCL 稳定身份与版本写入向 BOB 的迁移、ACC 期初向 VOU 的迁移及配置资料历史迁移均未执行，ADR-0046/0047 的现行归属仍有效。

本票只在可丢弃 PostgreSQL 与本地 API/Web 验收，未执行生产数据转换或部署。最终整体整合与 #382 的跨片验收仍需完成。
