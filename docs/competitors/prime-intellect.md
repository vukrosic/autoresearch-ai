# Prime Intellect

Sources:

- [Autonomous AI research for nanogpt speedrun](https://www.primeintellect.ai/auto-nanogpt)
- [Prime Intellect home](https://www.primeintellect.ai/)

## What They Do

Prime Intellect publicly released an autonomous speedrun setup around nanoGPT and described the harness files they used. The public lesson is that the durable working memory matters as much as the optimizer or model code.

Their blog describes:

- `AGENTS.md` for rules and autonomy constraints
- `goal.md` for mission context
- `plan.md` for mutable attempt state
- `scratchpad/THREAD.md` for durable mission logging
- run logs, idea notes, paper notes, variants, and sweeps

## What To Learn

- The harness is the product, not just the benchmark.
- File-based durability matters because agents lose context.
- Public scratchpads are a powerful trust and learning signal.
- The loop should preserve evidence, not just outcomes.

## What AutoResearch-AI Should Do Differently

- Stay smaller and easier to install.
- Target repo onboarding, not only benchmark runs.
- Make setup tests a first-class command path.
- Keep the open source npm package easy to fork.
