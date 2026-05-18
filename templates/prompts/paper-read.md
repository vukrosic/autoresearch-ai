# paper-read

Read a paper and produce structured notes connected to the local baseline.

## Usage

```bash
autoresearch paper-read <paper-id> [--from arxiv|local] [--dir PATH] [--cache-dir PATH] [--offline]
```

## What it does

1. Fetches the paper from arXiv by ID (or reads a cached local file with `--from local`).
2. Writes a structured note to `.researchloop/scratchpad/papers/<id>.md` with five required sections:
   - **Claim** — the paper's main claim (1–2 sentences from title/abstract).
   - **Mechanism** — how the method works (from abstract).
   - **Limits** — limitations (noted or "Not stated in abstract").
   - **How to port this** — practical steps to apply to your codebase (starts as TODO).
   - **Baseline relevance** — how this relates to the current goal (reads goal.md).
3. If the file already exists, merges new content without overwriting user edits.
4. Offline mode (`--offline` or `RESEARCHLOOP_OFFLINE=1`) succeeds when XML is cached.

## When to use

After `scan-papers` has found papers of interest, use `paper-read` to go deeper on specific papers and connect them to your research goal. The structured notes feed into `hypothesis --from-papers` (G30) and `priors` (G03).

## Agent instructions

When reading a paper for a researcher:

1. Start with `scan-papers` to discover relevant work.
2. Use `paper-read <id>` for each paper that looks promising.
3. Fill in the "How to port this" TODO section after reviewing the full paper.
4. Use the notes to generate hypotheses via `hypothesis --from-papers`.
