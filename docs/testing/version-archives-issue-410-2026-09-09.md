# BOB/WFL 版本档案验收（#410）

- 实现 SHA：`0c6a6f63bddd018637ace00c27c74012cb7ca896`。
- 范围：供应商、其他单位、销售合作方、客户、产品及流程定义统一进入公共 VersionPage；依据 [ADR-0060](../adr/0060-dynamic-page-runtime.md)。新增客户附件读取的可执行路由与领域授权规则，生成物同步更新。没有生产部署或业务数据迁移。
- 独占环境：Compose project `zerp-issue-410`，PostgreSQL/API/Web 端口 `55441/18086/18087`，数据库 `zerp_target_test`。连接串仅通过进程环境传递。

## 验收结果

下表的隔离命令前缀为 `sh .scratch/issue-410/run.sh`，用于设置独占端口、数据库环境和 Compose project；该临时脚本不进入仓库。日志保存在本地 `.scratch/issue-410/`。

| 命令                                                                                                    | 退出码 | 证据                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 隔离环境 `make check e2e`                                                                               | 2      | 生成、公共检查、构建、模型 31、前端 184、API 单元 81、持久化 19、集成 86、迁移 6 项通过；首次通用浏览器 22 通过、5 失败，未把聚合命令记为成功 |
| `pnpm --dir frontend typecheck` 与 `pnpm --dir frontend check`                                          | 0      | 修复后完整前端类型、静态、格式、构建检查，以及 178 项单元和 10 项真实 Vuetify 测试通过；日志 `frontend-final.log`                             |
| 最终 `pnpm --dir frontend typecheck`、`lint`、`format:check` 与 `git diff --check`                      | 0      | 最后流程实例权限修复后的静态检查；日志 `static-final.log`                                                                                     |
| 隔离环境 `pnpm --filter @zerp/api e2e -- bob-archives.spec.ts bob-customer.spec.ts bob-product.spec.ts` | 0      | 5/5，包含 390px、客户附件下载与产品十进制精度                                                                                                 |
| 隔离环境 `pnpm --filter @zerp/api e2e:wfl`                                                              | 0      | 1/1，定义编译、真实单据试跑、版本动作及原有实例动作通过                                                                                       |
| 隔离环境 `make -o target-test e2e`                                                                      | 0      | 最终完整通用浏览器 27/27、WFL 1/1、全凭证目录 2/2、期初凭证 2/2；日志 `browser-gate-final.log`                                                |

最后一项复用同一候选已通过的后端、模型及刷新后的前端检查证据，跳过 `target-test` 前置链；重新构建隔离 API/Web 并顺序运行全部浏览器套件。后端在完整 API 检查后未再修改。专项脚本完成时关闭临时 API/Web 并回滚 fixture。期初凭证页面仍有既存的 ResizeObserver 通知，测试通过。

首次浏览器失败暴露 Submission 读取传入多余字段，已统一投影为严格契约要求的 `{subjectId, submissionId}` 并增加公共入口回归；同时修正客户浏览器测试的重名标签定位。流程专项随后发现实例动作错误增加了不存在的统一权限门槛，已恢复以服务端 `availableActions` 为准的行为，单元与最终完整浏览器均通过。

## 公开入口与行为证据

- 六个 definition 经 Registry/ResourceHost 进入公共 VersionPage。旧 BOB 页面、流程定义页面及其 VM 已删除，专属生命周期测试迁至公共入口；流程实例单独保留原有功能边界。
- 公共入口 33 项回归覆盖临时编辑、当前/候选/历史隔离、差异、审批与撤销、理由与 revision、启停 blocker、查询与 Session 竞态、成功后刷新失败，以及未知写入的精确核实和同一提交身份重试。
- 客户保留子单位权限、局部维护、复制时身份重建、定价差异和附件流程；附件在提交前仅保留本地文件，暂存失败可重试，读取绑定授权版本。后端集成覆盖附件版本归属、权限与内容完整性。
- 产品保留单位与配方专属区块、最新材料快照采用、用户后选版本不被迟到读取覆盖和数量精度。流程定义保留图、脚本编译、真实凭证选择和试跑结果失效行为。
- 类型与架构检查约束资源定义、API 适配和旧路径不可达；已知身份及结算枚举由共享中文映射展示。

## 独立审查

- Standards：配方初始化竞态与区块输入投影问题已修复并补公开入口回归；复核无未解决项。
- Spec：依据 #408/#410 审查，版本读取与未知结果隔离等修复完成；最后的严格请求投影及实例动作权限修复经再次复核，无新增问题。

## 资源回收

隔离环境 `docker compose -p zerp-issue-410 -f compose.target.yaml down --volumes --remove-orphans` 退出 0。三个容器、网络及附件卷已删除；本次构建的 `zerp-issue-410-target-api:latest` 和 `zerp-issue-410-target-web:latest` 镜像删除成功。

回读没有本项目容器、网络或数据卷；三个独占端口无监听，专项测试脚本无残留进程。共享 `zerp-back` 服务未被终止。
