---
id: ADR-0050
date: 2026-09-03
status: accepted
---

# 数据库只负责持久化，业务规则由 Domain Service 承担

数据库只负责业务事实的持久化、查询、事务原子性与隔离，以及 PK、FK、NOT NULL、UNIQUE、简单数据形状 CHECK、CAS revision、事务锁和原子计数器等持久化完整性能力。普通查询可以继续使用 PostgreSQL 内置函数进行只读事实计算，包括 `SUM`、`COUNT`、分组、`HAVING`、CTE 和窗口函数；查询 SQL 只返回或持久化事实，不负责业务状态转换、跨聚合决策、业务流程编排或抛出稳定业务错误。

Domain Service 是业务规则和业务写入的唯一权威。它拥有其业务操作的 PostgreSQL transaction，在同一 transaction 内完成锁定、事实读取、业务校验、状态转换、跨聚合协调、Approval、领域事件和领域事实写入；任一步失败都回滚整笔操作。Handler、查询适配层、WFL、seed 和运维命令不得绕过 Domain Service 直接写业务表；手工 SQL 写入不属于受支持的业务写入方式。数据库不再定义自定义函数、存储过程、触发器或业务异常文本解析路径。

RPT 批准时继续由应用校验单条只读 SQL、类型化参数、`PREPARE`、`EXPLAIN`、限量执行和结果列契约。RPT 同时提供显式的应用发布校验命令：命令枚举全部 `enabled` 的 latest `APPROVED + VALID` 报表定义，并逐条复用批准时的同一应用校验核心。任一报表不兼容时，命令以非零状态失败并指出 definition，阻断当前数据库基线的重建或发布；该门禁不隐藏在 schema 执行、数据库函数或触发器中，也不回退到其他版本。

`dcl_subjects.code` 在数据库和查询边界保持 nullable 持久化事实。DCL、BOB、APP 和 RPT 的查询直接读取该 nullable 值；要求业务编码的 Go Domain consumer 在消费处拒绝缺失事实并返回应用数据不变量错误。任何消费方都不得把缺失值转换为空字符串、占位编码或 `COALESCE` 结果，也不得静默过滤掉该 subject。ACC Mapping 是允许无编码的例外，支持它的消费方必须保留空值语义。

本 ADR 建立 #355、#358 要求的单一持久化边界，补充 ADR-0047 关于 Subject 身份的规则，并与 ADR-0026 关于报表失效即停止及发布前验证的决定一致。HTTP/OpenAPI 契约、稳定 `errorKey` 和用户可见行为不因本边界调整而改变；实现时应删除数据库业务例程及其调用，改由公开 Domain Service seam、显式 RPT 发布命令和 Go nullable 校验承担对应语义，并重新生成受影响的 sqlc 类型。
