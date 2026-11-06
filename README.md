<p align="center">
  <img src="brand/jrabbit.svg" alt="jrabbit" width="208" />
</p>

<h1 align="center">jrabbit</h1>

<p align="center"><strong>Point at your UI. Your coding agent fixes it.</strong></p>

Stop pasting screenshots into your terminal. jrabbit is an MCP server for Claude Code and Codex: it opens your app with an overlay, you point at elements and comment, and your agent gets each request with the exact source file, applies it and shows you a before/after.

```sh
claude mcp add jrabbit -- npx -y jrabbit   # Claude Code
codex mcp add jrabbit -- npx -y jrabbit    # Codex
```

Or paste the setup prompt from [jrabbit.dev](https://jrabbit.dev) into your agent: it adds the server and opens your app. No account or API key.

> **Status:** early (0.1). Works with any MCP client over stdio. `file:line` resolution supports React on Next.js (Turbopack or webpack) and Vite. Requires Node 20+ and a running dev server.

## How it works

1. **Open** — ask your agent to open a review of `localhost:3000`. jrabbit proxies your dev server and injects the overlay. Your code is never touched.
2. **Point** — press **P**, click an element, write what you want, hit **Send**.
3. **Fix** — your agent receives each pin with screenshot, selector, viewport and `file:line`, then edits the code.
4. **Check** — every pin shows before/after. Approve or reopen.
5. **Remember** — corrections you repeat become rules in `.jrabbit/rules/`, versioned with your repo.

Everything is driven from the agent. The UI is only for what needs eyes.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Framework adapters (Vue, Svelte, Astro…) are especially welcome.

## Security

jrabbit is local by default: nothing leaves your machine unless you share it. Read the [security model](SECURITY.md#security-model). Report vulnerabilities privately, never in public issues; see [SECURITY.md](SECURITY.md).

## License

The code is [MIT](LICENSE). The jrabbit name and logo are trademarks and are not covered by the MIT License; see [TRADEMARK.md](TRADEMARK.md).

Contributions are accepted under the [Developer Certificate of Origin](DCO). This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
