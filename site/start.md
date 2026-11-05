# Set up jrabbit

You are a coding agent. The human wants jrabbit in this project: an MCP server that lets them point at their running UI in the browser and send you comments with the exact source file and line.

jrabbit runs entirely on this machine. It needs no account, key or login. Only change the MCP config described below. Do not edit the project's code to set it up.

## 1. Check if it is already set up

If you already have jrabbit tools (`open_review`, `wait_for_feedback`…), skip to step 4.

Otherwise check the config for your client:

- Claude Code: `claude mcp get jrabbit`
- Codex: `codex mcp get jrabbit`
- Cursor: look for a `jrabbit` entry in `.cursor/mcp.json`

If it exists, the server is configured but not loaded yet: go to step 3.

## 2. Add the server

Use the one that matches you. Do not install anything globally.

**Claude Code**, from the project root:

```sh
claude mcp add jrabbit -- npx -y jrabbit@0.1.1
```

**Codex**:

```sh
codex mcp add jrabbit -- npx -y jrabbit@0.1.1
```

**Cursor**, merge this into `.cursor/mcp.json` at the project root, keeping any other servers:

```json
{
  "mcpServers": {
    "jrabbit": {
      "command": "npx",
      "args": ["-y", "jrabbit@0.1.1"],
      "env": { "JRABBIT_ROOT": "${workspaceFolder}" }
    }
  }
}
```

Other MCP clients: a stdio server with command `npx` and args `-y jrabbit@0.1.1`. jrabbit uses the workspace root the client shares over MCP; if the client shares none, it uses the folder it starts in. Set `JRABBIT_ROOT` to the project path to pin it.

## 3. Load it

Most clients load new MCP servers only when a session starts. If the jrabbit tools are not available to you now:

1. Tell the human setup is done and give them the one command for their client. It restarts you and starts the review in the same step, so they type nothing else:
   - Claude Code: exit, then run `claude --continue "open a jrabbit review of my dev server"`
   - Codex: exit, then run `codex resume --last "open a jrabbit review of my dev server"`
   - Cursor: open Settings → MCP, make sure jrabbit is enabled, then send **"open a jrabbit review of my dev server"**
2. Stop here. Do not repeat setup after the restart.

## 4. Find the dev server

Look for a running local dev server for this project (check the `dev` script in `package.json` and which localhost ports are listening). If none is running, ask the human to start it, or start it yourself if they already asked you to.

## 5. Open the review

Call `open_review` with the dev server URL, for example `http://localhost:3000`.

Then call `status` and check that `store` is inside this project. If it is not, set `JRABBIT_ROOT` to the project's absolute path in the config from step 2 and go back to step 3.

Tell the human: in the browser tab that opened, press **P** to point at an element, write a comment, and press **Send**. Then call `wait_for_feedback`.

## How a review works

- `wait_for_feedback` returns each pin: comment, screenshot, selector and `file:line`.
- Make the change, then call `resolve_feedback` with a short summary. jrabbit captures an after shot. For several pins at once, pass `pins: [{ id, summary }]`.
- The human approves or reopens. Reopened pins come back through `wait_for_feedback`.
- If the human repeats the same kind of correction, call `propose_rule`. Rules live in `.jrabbit/rules/`, versioned with the repo, and apply only once the human approves them. Read them with `list_rules` before you start. Fix a rule with `update_rule` (it goes back to draft) or drop a draft with `delete_rule`.
- When the human asks to clear the board, call `archive_feedback`: approved pins move to `.jrabbit/archive/`.
