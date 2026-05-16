# LLM Auto Research Log

## 2026-05-15

AutoResearch-AI was moved into `/Users/vukrosic/my-life/autoresearch-ai` as the open source npm package and startup home.

The package was linked locally with `npm link`, then used against `llm-research-kit`.

Confirmed:

- CLI help works.
- Repo inspection works.
- Environment doctor works.
- Structured run recording works through `autoresearch record`.
- `llm-research-kit` can run a tiny synthetic training loop on this Mac through MPS.

Learning:

The product is already useful as an installable harness. The next feature should create idea files and experiment briefs, because recording is now covered by `autoresearch record`.
