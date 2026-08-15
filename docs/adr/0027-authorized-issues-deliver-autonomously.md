---
status: accepted
---

# Deliver authorized Issues autonomously to production

ZERP's target delivery model treats the `automation:ready` label, applied by a verified maintainer or administrator, as the single human authorization for an Issue. The authorization covers high-risk work such as authentication, database migrations, production configuration, and data repair only when the Issue states its risks, acceptance criteria, and recovery conditions. After authorization, automation owns the Issue through implementation, review remediation, exact-SHA validation, preview acceptance, merge, production verification, and Issue closure without another human gate.

Implementation and release approval are separate authorities: the implementation agent cannot approve its own result, and an independent trusted release verifier must reproduce the Issue acceptance criteria, repository gates, exact-SHA black-box E2E and browser scenarios, and production smoke evidence before it can publish `full-validation` or trigger merge. The verifier cannot modify the code it evaluates. An Issue whose requirements or acceptance criteria cannot be made objective is marked `automation:needs-input` and paused rather than guessed; resumption requires a maintainer to resolve the missing decisions, remove that label, and apply `automation:ready` again so the new authorization is auditable.

Implementation may proceed concurrently, but Ready validation, the fixed-preview slot, merge, and production release form one serialized release lane. Before entering that lane, every candidate must be replayed onto the latest `main` and produce fresh evidence. A failure before production traffic switches restores the prior baseline; after traffic switches, automation may roll back only when compatibility with the deployed database state is proven. Otherwise it freezes the release lane, creates an Incident Issue, and leaves the originating Issue open.

The queue lives only in the unified `hansonyu183/zerp` repository; the legacy `zerp-back` Issue automation and cross-repository forwarding are retired rather than retained as a compatibility path. Candidates become runnable only after their native GitHub dependencies are closed, then sort by explicit `priority:p0` through `priority:p3` and by the time they most recently entered `automation:ready` within the same priority; an Issue without an explicit priority is `priority:p2`.

Exactly one `automation:*` state label represents an Issue's workflow state; GitHub Checks and Deployments hold immutable validation and release evidence rather than duplicating state. Before a maintainer can authorize an Issue, it must state its outcome, scope and exclusions, and objective acceptance criteria, plus explicit risks and recovery conditions for high-risk work. Pull requests reference the Issue without an auto-closing keyword, and the release verifier closes it explicitly only after the merged production SHA, API, Web, and public entrypoint are all verified healthy.

For code or test failures, automation may make at most three repair rounds before marking the Issue `automation:blocked` and releasing the ordinary delivery lane. Infrastructure failures use bounded exponential backoff for at most 24 hours. Exhausting that budget also blocks the Issue without disguising the failure as an empty queue; a production Incident instead freezes the release lane until recovery is established.

Every pull request receives two independent read-only reviews: one against repository standards and one against the originating Issue and specification. The implementation agent resolves their actionable findings before the pull request can enter the release lane. Routine progress is recorded on the Issue and pull request without notifying the maintainer; `automation:needs-input`, `automation:blocked`, production Incidents, and final production completion generate notifications.

Automation credentials are separated by authority. Implementers may write feature branches and pull requests but cannot approve, merge, or deploy; reviewers are read-only apart from review evidence; the release verifier alone may publish `full-validation`; and the release controller alone may merge and operate preview or production. A repository-level kill switch can stop new work and releases immediately. A production Incident activates that switch automatically, and only an explicit maintainer resolution can reopen the release lane.

An authorized label event freezes the Issue body and relevant linked specifications as the immutable input for that run. Later edits or comments cannot expand the authorized scope; a maintainer changes it by moving the Issue to `automation:cancelled`, editing it, and applying `automation:ready` again. The execution location and Codex credential boundary in the original decision were revised by ADR-0028. The release lane remains singular. After trusted GitHub evidence is complete, the local release controller pulls only the verified exact SHA for fixed preview and production operations, publishes provenance-bound evidence, and requests the configured squash auto-merge.

New work enters through a GitHub Issue Form that requires outcome, scope, exclusions, and objective acceptance criteria, and conditionally requires risks and recovery conditions for high-risk work. Form submission does not authorize execution; only the later verified `automation:ready` event does.

## Consequences

This decision replaces the current boundaries that require non-Bot preview acceptance and prohibit automatic merge. Those boundaries remain in force until the automation, trusted evidence model, repository rules, and operating documentation are deployed together; accepting this ADR alone does not authorize either bypass.
