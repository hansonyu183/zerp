# Issue tracker: Local Markdown

Issues and specs for this repo live as Markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`.
- The specification is `.scratch/<feature-slug>/spec.md`.
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`; never use one combined tickets file.
- Triage state is recorded as a `Status:` line near the top of each issue file. See `triage-labels.md` for the role strings.
- Comments and conversation history append under a `## Comments` heading.

## Skill operations

- “Publish to the issue tracker” means creating the corresponding file under `.scratch/<feature-slug>/`.
- “Fetch the relevant ticket” means reading the referenced `.scratch/` file.
- A wayfinder map is `.scratch/<effort>/map.md`; its child tickets are numbered files under `.scratch/<effort>/issues/`.
- Child ticket blocking is recorded as `Blocked by: NN, NN`. Claiming sets `Status: claimed`; resolving appends `## Answer`, sets `Status: resolved`, and updates the map’s decisions-so-far.
