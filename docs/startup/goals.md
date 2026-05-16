# Product Goals

This file defines what AutoResearch-AI should do when it is working as a fully autonomous AI research loop.

## Mission

Help an AI agent turn a real machine learning repo into a disciplined research loop that can:

- understand the current machine and repo
- establish and protect a baseline
- generate grounded research ideas
- choose the cheapest useful experiment
- record evidence
- compare results
- recover from boring failures
- promote winning ideas into durable follow-up work

## Core Goals

### 1. Baseline First

The agent must not optimize blindly.

It should:

- inspect `.researchloop/baseline.md`
- create or update it when it is missing or incomplete
- record the artifact path, metric, command or config, frozen variables, and limitations
- treat the baseline as the starting point for all later decisions

### 2. Baseline-Aware Topic Intake

When the user names a topic, the agent should not jump straight to random experiments.

It should:

- check whether the baseline already exists
- summarize what is known and what is missing
- offer one of three modes:
  - `propose`: grounded options for the user to choose from
  - `novel`: genuinely different hypotheses with reasons, failure modes, and kill criteria
  - `autonomous`: the agent runs the loop after approval

### 3. Paper-Grounded Research

Paper search should strengthen the loop, not dominate it.

It should:

- search papers when the topic is broad or needs literature grounding
- turn papers into structured notes
- connect papers to concrete hypotheses
- prefer evidence-backed ideas over generic knob sweeps

### 4. Cheap-to-Run Experiments

The first experiment should be the cheapest meaningful test.

The agent should:

- freeze everything except one causal change
- use short runs first
- only widen the search after a candidate survives pruning or reproduction
- include a realistic time band for every proposed test

### 5. Failure Recovery

Autonomy should be robust to ordinary problems.

The agent should recover from:

- missing files
- wrong paths
- wrong interpreter or environment
- empty logs
- metric parsing failures
- stale or incomplete scratchpad state

When a failure happens, the agent should write the failure down and move to the next viable step instead of stopping the whole loop.

### 6. Evidence and Promotion

Winning ideas should not disappear into chat.

The loop should:

- record every run
- compare runs against baseline
- write idea notes before non-trivial experiments
- promote winning configs, diffs, or follow-up ideas into durable files

## What Autonomous Means

Autonomous does not mean reckless.

In this project it means:

1. Read the repo state first.
2. Respect the baseline gate.
3. Use papers when useful.
4. Propose or choose a small next step.
5. Run it.
6. Record the evidence.
7. Decide whether to reproduce, prune, refine, or pivot.

The user can still choose `propose` or `novel` when they want to steer the search.

## Non-Goals

AutoResearch-AI is not trying to be:

- a generic document chat app
- a full SciSpace clone
- a dashboard-first product
- a magical optimizer that skips evidence

The core product is the research loop.

## Success Criteria

The product is behaving well when a user can:

- install it
- point it at a repo
- see the baseline documented
- understand the current machine and repo
- get a few grounded ideas
- approve one small experiment
- see the result recorded and compared
- keep the loop going without losing context
