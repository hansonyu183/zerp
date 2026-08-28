---
id: ADR-0038
date: 2026-08-28
status: accepted
---

# Party 共享身份由 DCL 申报并投影到 BOB 当前业务面

Party 的稳定 ID、强类型关系边界和合并记录永久保留；共享身份的完整候选快照、版本、审批和审计由 DCL 拥有。`/dcl/party` 是身份候选、影响预览、审批、版本和合并维护入口；`/bob/party` 只读取 DCL latest approved 形成的当前身份及按权限裁剪的关系卡片。BOB 不保留 Party 保存、候选、审批、版本或审计写路径。

新 Party 不能单独创建。首条客户、供应、雇佣、服务或销售合作关系创建时，在同一个 PostgreSQL transaction 内建立 Party stable root、DCL Party V1 candidate 与关系；任一步失败全部回滚。V1 在批准前没有 BOB current，不能作为 BOB 当前主体读取或新的关系候选。强标识按“类型 + 规范化值”在 latest approved 与唯一 open candidate 间共同占用；批准、反批、占用和 BOB current 切换同事务完成。

批准和反批只原子地创建、替换、回落或移除 BOB Party current source。历史交易和关系快照不改写。主体合并仍是显式、预检保护的不可逆维护动作，但其资料读取和 stale 检查以 DCL current source 为准，不能绕过 DCL 写边界。系统不保留 BOB Party save 别名、双写、兼容读取或第二套 identity revision。
