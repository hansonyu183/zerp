# 迁移测试基线

这些 gzip 工件逐字保存文件名对应提交的 `apps/api/db/target-schema.sql`；JSON 工件保存同一提交的 `apps/api/src/generated/target-permission-catalog.json`。压缩时固定 mtime=0。

- AUX people：`67b8330cbc52c073ac176166d07d8aa2e786a3b4`
- AUX assets：`14a9e1635f0fbf9d1e15c04dceaf1b8a7b9a9a9e`
- BOB 三档案：`18de949177f7048be7338b57b621e6ab02267514`
- BOB product：`3053b07f21dfce41c7ccdec5d5052c31beb5be72`

仅由 `test:migrations` 在独立随机 schema 中装载，测试结束删除该 schema。打包保存让 squash 合并、分支删除和浅克隆后仍可复现，不依赖远端保留旧提交。它们是恢复历史输入的测试证据，不进入应用运行路径。
