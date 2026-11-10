# Set up jrabbit

You are a coding agent. The human wants jrabbit in this project: an MCP server that lets them point at their running UI in the browser and send you comments with the exact source file and line. You are their partner for shipping: they point, you fix it right away, and they never have to ask twice.

jrabbit runs entirely on this machine. It needs no account, key or login. Only change the MCP config described below. Do not edit the project's code to set it up.

The human should not have to restart anything or type anything else. Do every step yourself, in this session.

## 1. Check if it is already set up

If you already have jrabbit tools (`open_review`, `wait_for_feedback`…), skip to step 3.

Otherwise check the config for your client:

- Claude Code: `claude mcp get jrabbit`
- Codex: `codex mcp get jrabbit`
- Cursor: look for a `jrabbit` entry in `.cursor/mcp.json`

If it exists, skip to step 3.

## 2. Add the server

This makes the jrabbit tools load in the human's next sessions. Do not install anything globally.

Run this from the project root. It finds Claude Code, Codex and Cursor and sets up each one. In Claude Code it also adds a Stop hook to `.claude/settings.local.json`, which keeps you in the review while the human has it open:

```sh
npx -y jrabbit@0.2.0 init
```

If it reports a problem, add the server by hand with the one that matches you:

**Claude Code**, from the project root:

```sh
claude mcp add jrabbit -- npx -y jrabbit@0.2.0
```

**Codex**:

```sh
codex mcp add jrabbit -- npx -y jrabbit@0.2.0
```

**Cursor**, merge this into `.cursor/mcp.json` at the project root, keeping any other servers:

```json
{
  "mcpServers": {
    "jrabbit": {
      "command": "npx",
      "args": ["-y", "jrabbit@0.2.0"],
      "env": { "JRABBIT_ROOT": "${workspaceFolder}" }
    }
  }
}
```

Other MCP clients: a stdio server with command `npx` and args `-y jrabbit@0.2.0`. jrabbit uses the workspace root the client shares over MCP; if the client shares none, it uses the folder it starts in. Set `JRABBIT_ROOT` to the project path to pin it.

## 3. Find the dev server

Look for a running local dev server for this project (check the `dev` script in `package.json` and which localhost ports are listening). If none is running, ask the human to start it, or start it yourself if they already asked you to.

## 4. Open the review

You only receive pins while you are waiting for them, and jrabbit cannot wake you once your turn ends. So once the review is open, do not end your turn: keep waiting, fixing and resolving until the human ends the review. A sent pin is the request itself: change the code without asking the human to confirm. Be quick: fix the pins of a batch in one pass, and do not narrate or re-plan between them.

The review ends when the human presses **Done** in the browser (the wait returns `done`), when they leave it untouched for 30 minutes (`idle`), or when they tell you they are done: then call `close_review`, or run `npx -y jrabbit@0.2.0 close`.

**If you have the jrabbit tools**, call `status` first and check that `store` is inside this project. If it is not, set `JRABBIT_ROOT` to the project's absolute path in the config from step 2. Tell the human in one line: in the browser tab that is about to open, press **P** to point at an element, write what should change, and press **⌘↵** to send it. Then call `open_review` with the dev server URL, for example `http://localhost:3000`. It opens the browser and already waits for the first pins. When it returns, follow its `next` field: fix the pins, or call `wait_for_feedback` again, in the same turn.

**If you do not have the tools yet** (you just added the server), they load only in the next session. Do not ask the human to restart. Run the same review from the shell instead, from the project root:

1. Start it in the background and leave it running. It opens the browser:
   ```sh
   npx -y jrabbit@0.2.0 open http://localhost:3000
   ```
2. Tell the human in one line: in the browser tab that opened, press **P** to point at an element, write what should change, and press **⌘↵** to send it. Do not end your turn.
3. Wait for their pins. This blocks up to 50 seconds and prints the pins as JSON: comment, selector, `file:line` and the path of the before screenshot. On `timeout`, run it again right away. On `done`, stop:
   ```sh
   npx -y jrabbit@0.2.0 wait
   ```
4. For each pin, look at the screenshot, edit the code, then resolve it. The browser captures the after shot and the human approves or reopens there. Then go back to step 3:
   ```sh
   npx -y jrabbit@0.2.0 resolve 1 "Halved the space above the price"
   ```

Pins are saved in `.jrabbit/`, shared with the MCP server, so the jrabbit tools pick up where you left off in the next session.

## How a review works

- `wait_for_feedback` returns each pin: comment, screenshot, selector and `file:line`.
- Make the change without asking first, then call `resolve_feedback` with a short summary. jrabbit captures an after shot. For several pins at once, pass `pins: [{ id, summary }]`.
- Call `wait_for_feedback` again. The human approves or reopens in the browser; reopened pins and new ones come back through it. Leave `timeout_seconds` out: jrabbit waits as long as your client allows.
- Stop when it returns `done` or `idle`. When the human says they are done, call `close_review`.
- If the human repeats the same kind of correction, call `propose_rule`. Rules live in `.jrabbit/rules/`, versioned with the repo, and apply only once the human approves them. Read them with `list_rules` before you start. Fix a rule with `update_rule` (it goes back to draft) or drop a draft with `delete_rule`.
- When the human asks to clear the board, call `archive_feedback`: approved pins move to `.jrabbit/archive/`.
