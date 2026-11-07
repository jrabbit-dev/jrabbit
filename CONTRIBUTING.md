# Contributing to jrabbit

Thanks for helping. jrabbit is in early development, so the codebase moves fast.

## Getting started

```sh
git clone https://github.com/jrabbit-dev/jrabbit.git
cd jrabbit
npm install
```

## Ground rules

- Every action in the UI must have an equivalent MCP tool. A UI action without a tool is a bug.
- Approvals are always human. The agent can never mark something as approved by a person.
- Tool outputs are structured and idempotent.
- Never weaken the [security model](SECURITY.md#security-model). If a change touches it, say so in the PR.

## Pull requests

- Open an issue first for anything bigger than a small fix.
- Keep PRs focused on one change.
- Sign off every commit (see below). PRs with unsigned commits cannot be merged.
- Security vulnerabilities go through [private reporting](SECURITY.md), never a public PR.

## Licensing

### Your contributions: Developer Certificate of Origin

jrabbit uses the [Developer Certificate of Origin 1.1](DCO) instead of a CLA. By adding a `Signed-off-by` line to a commit, you certify that you wrote it or otherwise have the right to submit it under the project's license.

```sh
git commit -s -m "Fix overlay position on scroll"
```

This adds `Signed-off-by: Your Name <your@email>` using your git identity. The name must be your real name or a consistent identity, not anonymous.

Forgot to sign off? Fix the last commit with `git commit --amend -s --no-edit`, or all commits on your branch with `git rebase --signoff main`, then force-push.

Contributions are licensed under the [MIT License](LICENSE) (inbound = outbound). You keep the copyright on your contribution.

### AI-assisted contributions

Code written with an AI assistant is welcome. You are still the author who signs off: you must have reviewed it, understand it and be able to certify the DCO for it. Do not submit code that reproduces third-party code under an incompatible license.

### Dependencies

New dependencies must be justified in the PR and use a permissive license compatible with MIT:

`MIT`, `ISC`, `BSD-2-Clause`, `BSD-3-Clause`, `Apache-2.0`, `0BSD`, `BlueOak-1.0.0`, `CC0-1.0`, `Unlicense`, `Python-2.0`, and `CC-BY-4.0` for data packages.

Copyleft licenses (`GPL`, `AGPL`, `LGPL`, `MPL`, `EUPL`, `SSPL`) and source-available licenses (`BUSL`, `Elastic`, `Commons Clause`) are not accepted. CI checks this on every PR.

Copied snippets (Stack Overflow, other repos) need their source and license in a comment, and must use a compatible license. Stack Overflow content is CC BY-SA and generally cannot be copied verbatim.

### Name and logo

The MIT License covers the code, not the jrabbit name or logo. See [TRADEMARK.md](TRADEMARK.md).

## Code of conduct

This project follows the [Contributor Covenant 2.1](CODE_OF_CONDUCT.md). Report unacceptable behavior to info@jrabbit.dev.
