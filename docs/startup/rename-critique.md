# Rename Critique

This is a direct critique of what we did badly during the move from ResearchLoop to AutoResearch-AI.

## What We Did Not Do Well

### 1. We Renamed The Package Before Renaming The Whole Experience

The npm package became `autoresearch-ai`, but the rest of the surface still carried mixed names for too long.

That created a split-brain product:

- users install `autoresearch-ai`
- some docs and scripts still pointed at the old repo home
- generated prompts and helper names still mixed `ResearchLoop` and `AutoResearch-AI`
- skills and some local control-room files kept legacy names
- the state folder stayed `.researchloop/`

That is confusing for a new user. The first command after install should feel like the same product they just installed.

### 2. We Treated Naming As Copy, Not Architecture

The name appears in:

- npm package metadata
- CLI binary names
- generated help text
- docs
- prompt templates
- tests
- skill names
- generated state folders
- dashboard copy
- release docs

We updated some visible docs, but not the underlying command surface. That made the rename feel cosmetic.

### 3. We Left The First-Run Prompt Too Package-Aware For Too Long

Earlier onboarding made agents summarize the package and prompts instead of talking to the user about their system, repo, GPU, and baseline.

The current first-contact prompt is much better, but the naming mismatch still leaks product internals into the user experience.

### 4. We Did Not Define A Compatibility Strategy Early

Renaming a CLI is a breaking change if done suddenly.

We should have decided:

- preferred new command
- legacy alias duration
- whether `.researchloop/` is a stable data format or a legacy folder
- whether skills keep old names or get new names with aliases
- which docs show the new command and which mention compatibility

Without that plan, every rename risks breaking existing users or tests.

### 5. We Duplicated Agent Instructions Across Too Many Surfaces

The same behavior lived in prompts, generated `AGENTS.md`, skills, docs, and tests.

That made each behavior change expensive and easy to miss.
The canonical prompt files helped, but the skill and docs surfaces still need stricter ownership.

### 6. We Let Internal Names Leak Into Public Marketing

`ResearchLoop` described the mechanism.
`AutoResearch-AI` describes the promise.

The public experience should lead with the promise:

- automated AI research
- baseline-first research
- paper-grounded hypotheses
- autonomous experiment loops

The old name can remain in compatibility notes, historical changelog entries, or the `.researchloop/` folder until we migrate safely.

## Recommendation

Do the rename in layers.

### Layer 1: Public Command Rename

Ship `autoresearch` as the preferred CLI command.

Keep these aliases:

- `autoresearch-ai`
- `researchloop`

Docs should show `autoresearch`.
Compatibility notes can say that `researchloop` still works.

### Layer 2: User-Facing Copy

Use `AutoResearch-AI` in:

- README
- getting started
- site copy
- generated help
- first-contact prompts
- topic-intake prompts
- generated agent instructions

Avoid saying ResearchLoop unless explaining legacy compatibility.

### Layer 3: State Folder Decision

Keep `.researchloop/` for now.

Reason: changing the state folder would break existing repos and many tests.
Treat it as the stable local data directory until we implement a migration path.

Later options:

- keep `.researchloop/` permanently as the data format
- support `.autoresearch/` for new repos and read `.researchloop/` as legacy
- add `autoresearch migrate-state` if the folder rename becomes worth it

### Layer 4: Skill Rename

Rename skill packs only after the CLI rename is stable.

The likely target is:

- `skills/autoresearch-ai/`
- skill names like `autoresearch-baseline-first`

Keep old skill names or shims until users have a migration path.

## Rule For Future Rename Work

Any rename must update these together:

- package metadata
- binary names
- help text
- README
- getting started
- prompt templates
- generated agent files
- tests
- packed-package check

If a surface is intentionally not renamed, document why.
