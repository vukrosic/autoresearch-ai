# Deploy Helpers

These helpers are for testing the current local AutoResearch-AI build.

## Preferred install flow

1. Pack the current `autoresearch-ai` checkout.
2. Install the tarball into the test environment.
3. Launch a fresh agent in an empty lab folder.
4. Use the onboarding prompt from `../prompts/onboarding.md`.

Scripts:

- `./pack-current-build.sh`
- `./install-current-build.sh`
- `./create-lab.sh`

## Local build path

Use the packed tarball when you want the freshest current changes.

## Why not ship this

These scripts and notes are local deployment tooling, not product features.
