# Critique

This is the honest read on AutoResearch-AI today.

## What Is Strong

- The thesis is real: autonomous AI research is an actual workflow, not just a buzzword.
- The MacBook path is proven enough to keep building.
- The CLI shape is simple and portable.
- The open source boundary makes the product easier to trust.

## What Is Still Weak

- The website is better, but still mostly explains the product instead of proving a workflow users can run immediately.
- The CLI currently covers setup, inspect, prompt, doctor, record, and report, but not yet a full experiment planner or compare workflow.
- The setup story is good for local smoke testing, but not yet tested against a real first-time external repo user.
- Competitor intelligence is useful, but it will drift unless we keep updating it.
- The user discovery loop exists on paper, but it still needs live conversations and notes.

## What To Improve Next

- Add `autoresearch idea` or `autoresearch compare` so the loop feels more like a product and less like a file bundle.
- Add a CI job for `npm run test:setup`, `npm run test:prompts`, and `npm run test:site`.
- Put one real external repo onboarding note into the research log.
- Turn one user conversation into a reusable onboarding example.
- Keep the homepage focused on the first successful run, not a broad story.

## Bottom Line

AutoResearch-AI is promising because it has a real use case, a real Mac-compatible proof, and a simple open source shape. It still needs more productization around the experiment loop and more proof from actual users before it feels like a durable startup.
