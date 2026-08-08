# Separate automated validation from release readiness

ZERP distinguishes automated `validation` from the required `full-validation` release-readiness decision. Automated validation proves that the exact pull-request head is eligible for preview; when the change-impact policy requires fixed preview, `full-validation` remains incomplete until a GitHub Preview Deployment records successful human acceptance for the same pull request, head SHA, and preview-state generation. This prevents a green test suite or a successful deployment from being mistaken for completed acceptance while retaining one stable branch-protection interface.

## Consequences

Changes that do not require fixed preview can produce `full-validation` immediately after automated validation. Any new pull-request commit invalidates prior automated and human evidence, and the merge commit may reuse the result only when its Git tree is identical to the accepted pull-request tree. Component checks remain visible, but branch protection and the production publisher depend on `full-validation` rather than maintaining separate duplicated check-name lists.
