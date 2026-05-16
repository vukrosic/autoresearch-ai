# AutoResearch-AI Getting Started

AutoResearch-AI is an open source npm package that helps an AI agent run a disciplined research loop inside a machine learning repo, published on npm as `autoresearch-ai`.

The shortest way to think about it:

- you install the CLI
- you point it at a target repo or research dir
- it creates a durable `.researchloop/` workspace
- your AI agent uses that workspace to plan, run, compare, and record experiments

If no target repo is obvious, use this rule:

1. If the current folder is a real repo, use it.
2. If the current folder is empty or not a repo, ask: "Use this folder, point me at a GitHub repo, or spin up a demo research repo?"
3. If the user has a GitHub URL, offer to clone it and run there.
4. If the user has a local path, use that path.
5. If the user has neither, offer either a disposable demo repo or the local `llm-research-kit` repo as the no-friction fallback.

When the repo already has history, read `.researchloop/scratchpad/runs.jsonl` and `.researchloop/scratchpad/THREAD.md` first, then propose the next experiment from that evidence instead of defaulting to a sweep.
If `.researchloop/plan.md` does not already have a time budget, ask one question first: "How long do you usually want a typical experiment to run?" Save the answer in `Time Budget` and use it to shape later suggestions.

## 1. Give This Prompt To Your Agent

Copy this into Codex, Claude Code, Hermes, Cursor, or another coding agent:

```text
Install the `autoresearch-ai` npm package if needed. Act as an automated AI researcher and follow the AutoResearch-AI first-contact and topic-intake prompts.
Read the AutoResearch-AI docs and the `.researchloop/` files, then help me start AI research: inspect the local system for GPUs/accelerators, inspect the workspace for likely AI research repos, explain what I have in plain language, and check whether a baseline exists and where it is documented.
When I give a research topic, use the existing baseline if it exists; if it does not, propose documenting `.researchloop/baseline.md` first. Then offer propose, novel, or autonomous mode.
Do not summarize package internals, tarball contents, prompt files, or skill files unless I explicitly ask.
Do not run init, training, baselines, sweeps, or experiments until I approve the plan.
Use the package commands to manage goals, ideas, prompts, runs, comparisons, and reports.
```

## 2. Install

From your own machine:

```bash
npm install -g autoresearch-ai
```

The package name is `autoresearch-ai`; the primary CLI command is `autoresearch`, with `researchloop` kept as a legacy alias.

For local development from this repo:

```bash
cd /Users/vukrosic/my-life/autoresearch-ai
npm link
autoresearch --help
```

If you want to hand this to an AI agent, the simplest instruction is:

```text
Install AutoResearch-AI, follow `templates/prompts/first-contact.md`, inspect the system and project read-only, explain what I have in plain language, check the baseline state first, then propose a plan. Wait for my approval before any init, training, baseline, sweep, or experiment command.
```

## 3. Initialize a repo

Run this inside a blank folder, an existing ML repo, or a target research dir:

```bash
autoresearch init --agent codex
```

That creates:

```text
.researchloop/
  AGENTS.md
  baseline.md
  goal.md
  plan.md
  repo-profile.json
  scratchpad/
    THREAD.md
    runs.jsonl
    memory.md
    ideas/
    papers/
    variants/
    sweeps/
```

If you want the agent-specific file for another tool, use:

```bash
autoresearch init --agent claude-code
autoresearch init --agent hermes
autoresearch init --agent cursor
```

## 3b. Give a research topic

When you say something like "research query/key architectures", the agent should treat it as topic intake.

First it checks whether a usable baseline already exists. If `.researchloop/baseline.md` is missing or incomplete, the first proposed step should be to create or update that markdown note from existing artifacts. It should not recommend architecture, optimizer, sweep, or training changes until the baseline is clear.

After the baseline is clear, choose one of these modes:

```text
propose     the agent suggests 2-4 grounded options and waits for your choice
novel       the agent reasons about genuinely different hypotheses and their failure modes
autonomous  the agent runs the loop after explicit approval and within the time budget
```

Paper search is optional. Use it when the topic is broad, when the repo has no relevant paper notes, or when a proposed idea needs literature grounding.

## 4. Set the research goal

Tell AutoResearch-AI what the agent should optimize:

```bash
autoresearch goal "lower validation loss"
```

You can also add structure:

```bash
autoresearch goal "lower validation loss" --metric val_loss --direction lower
```

That saves the objective into `.researchloop/goal.md`, which the agent and the prompt command can read later.

## 5. Generate experiment ideas

```bash
autoresearch idea --write
```

This prints a chat-first idea prompt that reads the repo history, asks for the typical experiment length if needed, and then asks the LLM to propose a few real research ideas. For `llm-research-kit`, that usually means baseline checks, history-aware follow-ups, and the staged training ladder when the repo history says longer runs are justified. For a generic repo, it starts with finding the baseline and the real mechanism to test.

## 6. Inspect the repo

```bash
autoresearch inspect
```

This writes a repo profile into `.researchloop/repo-profile.json` and helps the agent understand:

- possible training files
- possible eval files
- config files
- log folders
- likely adapters

## 7. Generate the agent prompt

```bash
autoresearch prompt --agent codex
```

Paste the output into your AI agent.

You can also attach a focused playbook:

```bash
autoresearch prompt --agent codex --focus hyperparameters
autoresearch prompt --agent codex --focus architecture
autoresearch prompt --agent codex --focus attention
autoresearch prompt --agent codex --focus training-ladder
```

That prompt tells the agent to first explain the detected system context and repo context in plain language, then ask for approval before running anything. After approval, it tells the agent to:

- read the `.researchloop/` files
- establish a baseline
- propose small experiments
- record runs
- compare results
- keep the loop moving

## 7b. Use the skill pack

The npm package also ships a downloadable `skills/` folder.

It contains the same research loop as agent-local skills:

- `skills/researchloop-autoresearch/codex/SKILL.md`
- `skills/researchloop-autoresearch/claude-code/CLAUDE.md`
- `skills/researchloop-autoresearch/hermes/HERMES.md`
- `skills/researchloop-autoresearch/cursor/researchloop.mdc`
- `skills/researchloop-autoresearch/references/*.md`
- `skills/researchloop-training-ladder/SKILL.md`

Use those files when you want the agent itself to carry the research rules, not just the current prompt.

Typical flow:

1. Copy the Codex or Claude Code file into the skill location your agent uses.
2. Keep the `references/` files nearby as optional playbooks.
3. Pair the skill with `.researchloop/goal.md` and the `autoresearch prompt` output.

You can still pass `--goal` for a one-off override, but the normal flow is to save the goal once and let the prompt command read it back.

If you want the prompt to narrow in on a family of experiments, use one of the built-in focus playbooks:

- `hyperparameters`
- `architecture`
- `attention`
- `training-ladder`

## 8. Record and compare runs

After a run finishes:

```bash
autoresearch record --id first-run --status complete --metric val_loss=2.31 --note "first logged experiment"
```

To compare runs:

```bash
autoresearch compare --metric val_loss --direction lower
```

For metrics where higher is better:

```bash
autoresearch compare --metric accuracy --direction higher
```

Then summarize the current state:

```bash
autoresearch report
```

## 9. Open the dashboard

Serve a local dashboard for the current repo:

```bash
autoresearch dashboard
```

Then open the localhost URL it prints. The dashboard reads the repo's `.researchloop/` files and shows:

- the saved goal
- the run ledger
- the best run so far
- the latest run
- a small trend chart for the main metric

It does not need accounts or auth because it stays on your machine.

## 10. Generate a team board for parallel work

If you want to develop AutoResearch-AI itself, or split any repo into parallel lanes, generate a local team board:

```bash
autoresearch team --workers 8
```

That writes `.researchloop/team/` with:

- an orchestrator brief
- a reviewer brief
- one worker file per lane
- a board that maps branches, files, and done criteria

The intended flow is:

1. Human sets the release goal.
2. Orchestrator assigns the lanes.
3. Workers take one branch or worktree each.
4. Reviewer checks the diffs before merge.
5. Human merges the branches that have evidence.

## 11. Test the setup before you trust it

Run the local checks from this repo:

```bash
npm test
```

That aggregates the full fast suite: `smoke`, `smoke:e2e`, `test:setup`, `test:compare`, `test:run`, `test:scan-papers`, `test:goal`, `test:idea`, `test:team`, `test:dashboard`, `test:prompts`, `test:focus-prompts`, `test:site`, and `test:adapters`.

Before publishing, also run the packed-tarball install check:

```bash
npm run test:release
```

That runs `npm test` plus `test:packed`, which packs the npm tarball, installs it into an isolated prefix, and runs the harness end-to-end. It catches `files:` whitelist regressions that local-link testing silently masks.

## 12. Use it in a real ML repo

Once the basics work, move into a real project:

```bash
cd /path/to/your/ml-repo
autoresearch init --agent codex
autoresearch inspect
autoresearch prompt --agent codex --goal "improve validation loss"
```

Then give the prompt to your AI agent and let it run the loop.

AutoResearch-AI is not trying to magically solve the model for you. It gives the agent the operating system for research: goals, baseline, logs, comparison, and continuation.

## 12. Publish to npm

The package is published to the public npm registry at [npmjs.com](https://www.npmjs.com/).

Before publishing:

```bash
npm login
npm whoami
npm pack --dry-run
```

Make sure the package name is available and the contents look right.

For this repo, the package name is `autoresearch-ai` in `package.json`. Publish with:

```bash
npm publish
```

If you later switch to a scoped package like `@yourname/autoresearch`, publish with:

```bash
npm publish --access public
```

Common release flow:

```bash
npm version patch
git push --follow-tags
npm publish
```

Typical release checklist:

1. run the local tests
2. check `npm pack --dry-run`
3. bump the version
4. publish to npm
5. update the website and README if the usage changed

## 12. Where users install it from

Users install it from the npm registry with:

```bash
npm install -g autoresearch-ai
```

If they prefer local use inside one repo:

```bash
npm install autoresearch-ai
```

Then they run the CLI from that environment.

## 13. The one-line handoff to an AI agent

If you want the shortest possible instruction for Codex, Claude Code, Hermes, Cursor, or a similar agent, give it this:

```text
Use AutoResearch-AI: install or use the package, act as an automated AI researcher, and follow `templates/prompts/first-contact.md`. Inspect the system for GPUs/accelerators, inspect the workspace for likely AI research repos, explain what I have in plain language, and check whether a baseline exists and where it is documented. Do not summarize package internals or prompt files. Do not run init, baselines, training, sweeps, or experiments until I approve the plan.
```
