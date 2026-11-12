<p align="center">
  <img src="brand/jrabbit.svg" alt="jrabbit" width="208" />
</p>

<h1 align="center">jrabbit</h1>

<p align="center"><strong>Your partner for shipping products.</strong></p>

Point at what is off in your running app and send it. Your agent fixes it while you keep looking, and shows you the before and after.

jrabbit is an MCP server for Claude Code, Codex and Cursor. It opens your app with an overlay: you click what you want changed and say how. Your agent gets the exact source file, makes the change right away and shows you a before and after. You send it once. You do not go back to the terminal to ask.

```sh
npx jrabbit init
```

That sets up every agent it finds in your project. Or paste the setup prompt from [jrabbit.dev](https://jrabbit.dev) into your agent: it adds the server and opens your app. No account or API key.

<details>
<summary>Add it by hand</summary>

```sh
claude mcp add jrabbit -- npx -y jrabbit   # Claude Code
codex mcp add jrabbit -- npx -y jrabbit    # Codex
```

</details>

> **Status:** early (0.2). Works with any MCP client over stdio. `file:line` resolution supports React on Next.js (Turbopack or webpack) and Vite. Requires Node 20+ and a running dev server.

## How it works

1. **Open** — ask your agent to open a jrabbit review. jrabbit proxies your dev server and injects the overlay. Your code is never touched.
2. **Point** — press **P**, click an element, write what you want and press **⌘↵**. It is sent. Use **Add to queue** to line up several and send them together.
3. **Fix** — your agent receives each pin with screenshot, selector, viewport and `file:line`, and edits the code without asking you to confirm.
4. **Check** — every pin shows before/after and how long the fix took. Approve or reopen.
5. **Remember** — corrections you repeat become rules in `.jrabbit/rules/`, versioned with your repo.

## You send it once

jrabbit cannot wake an agent whose turn has ended, so it keeps the agent in the review instead:

- The agent waits for your pins for as long as its client allows per call (4.5 minutes in Claude Code, 55 seconds elsewhere; set `JRABBIT_WAIT_SECONDS` to change it) and waits again.
- In Claude Code, `jrabbit init` adds a Stop hook to `.claude/settings.local.json`: the agent cannot end its turn while you have the review open or a sent pin is unresolved. `npx jrabbit init --no-hook` skips it.
- The review ends when you press **Done** in the Pins panel, close the tab, tell the agent you are done, or leave it untouched for 30 minutes.

Everything is driven from the agent. The UI is only for what needs eyes.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Framework adapters (Vue, Svelte, Astro…) are especially welcome.

## Security

jrabbit is local by default: nothing leaves your machine unless you share it. Read the [security model](SECURITY.md#security-model). Report vulnerabilities privately, never in public issues; see [SECURITY.md](SECURITY.md).

## License

The code is [MIT](LICENSE). The jrabbit name and logo are trademarks and are not covered by the MIT License; see [TRADEMARK.md](TRADEMARK.md).

Contributions are accepted under the [Developer Certificate of Origin](DCO). This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
