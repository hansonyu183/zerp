# Cutover fixtures

These SQL files are immutable database snapshots used only by integration
cutover compatibility tests. They deliberately keep historical table names and
data that do not belong to the current runtime schema.

- `historical-pre-issue-289.sql` freezes the database immediately before issue
  #289. Its seeded AUX objects and approval payloads drive the ordered
  #289-#293 historical cutover chain.
- `pre-issue-305.sql` freezes `main` immediately before issue #305. Its seeded
  DCL approvals plus BOB identity/current rows provide the validated input for
  the #305 architecture cutover; that cutover is implemented by issue #305.

The integration runner must read these files directly. Do not replace them
with `git show`, a commit SHA, a network download, or the current
`db/schema.sql`.
