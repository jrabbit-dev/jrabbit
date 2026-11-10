# Security Policy

jrabbit runs on your machine, proxies your dev server and reads your source code. We treat every report seriously.

## Reporting a vulnerability

**Do not open a public issue, discussion or pull request for a vulnerability.**

Report it privately through GitHub: go to the **Security** tab of this repository and click **Report a vulnerability**. Include:

- the affected version (`npx jrabbit --version`) and your OS, Node version and framework;
- what an attacker can do, and under which conditions;
- steps to reproduce, ideally a minimal repo or proof of concept.

## What to expect

| Step | Target |
| --- | --- |
| Acknowledgement | within 3 business days |
| Initial assessment and severity (CVSS) | within 7 days |
| Fix for critical / high | within 30 days |
| Fix for medium / low | next regular release |

We will keep you updated, credit you in the advisory unless you prefer otherwise, and request a CVE through GitHub when it applies. We follow coordinated disclosure: please give us up to 90 days, or until a fix is released, before publishing details.

## Supported versions

jrabbit is in early development. Only the **latest published version** receives security fixes. Once 1.0 ships, the latest minor of the current major will be supported.

## Scope

In scope:

- the `jrabbit` npm package (MCP server, CLI, local proxy and overlay);
- the `.jrabbit/` file formats and how jrabbit reads them;
- the GitHub Actions workflows and release pipeline in this repository.

Out of scope:

- vulnerabilities in your own app or dev server that jrabbit merely proxies;
- issues that require an attacker who already has local code execution on your machine;
- issues in third-party dependencies with no demonstrated impact on jrabbit (report those upstream);
- missing hardening headers on pages that only exist on `localhost`, without a concrete exploit.

## Security model

These are the guarantees jrabbit is built around. A change that breaks one of them is a security bug.

1. **Local by default.** The proxy and every local server bind to `127.0.0.1` only, never `0.0.0.0`.
2. **The overlay authenticates to the local server.** Requests from the overlay carry a per-session random token; requests from other origins are rejected (no DNS rebinding, no cross-site requests to the local server).
3. **Nothing leaves your machine unless you ask.** No telemetry without explicit opt-in. Screenshots, recordings, transcripts and pins stay in `.jrabbit/` on disk. Only the `share` tool uploads anything, and only what that round contains.
4. **Third-party services are opt-in.** Speech-to-text runs locally by default; any cloud provider requires explicit consent per use.
5. **Approvals are human.** The agent can never mark a pin as approved by a person.
6. **jrabbit does not edit your code.** Your coding agent does, under its own permission model. jrabbit only reads source files to resolve `file:line`.
7. **Secrets stay out of pins.** Input values of `password`, `hidden` and autocomplete-credential fields are never stored in pins, DOM snapshots or logs. Screenshots mask them too, along with card (`cc-*`), `one-time-code` and fields named like a token, API key or secret. Add `data-jrabbit-mask` to any other field to mask it, or `data-jrabbit-mask="false"` to show one we mask by mistake.

## Supply chain

- Releases are published to npm from GitHub Actions with [trusted publishing](https://docs.npmjs.com/trusted-publishers) and [provenance attestations](https://docs.npmjs.com/generating-provenance-statements). Verify with `npm audit signatures`.
- Third-party GitHub Actions are pinned to full commit SHAs and updated by Dependabot.
- Runtime dependencies are kept to a minimum and must use a permissive license (see [CONTRIBUTING.md](CONTRIBUTING.md#licensing)).

## Safe harbor

We will not pursue legal action against good-faith research that follows this policy, avoids privacy violations and data destruction, and does not degrade the service of others. If in doubt, ask us first through a private report.
