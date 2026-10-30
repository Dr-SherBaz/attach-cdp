# attach-cdp

**Drive the Chrome you are already logged into — from your terminal, or from an AI agent.**

Most browser automation starts a *new* browser: empty profile, no cookies, no sessions, so the first thing it hits is a login wall. `attach-cdp` does the opposite. It finds the Chromium browser that is already running on your machine, connects to it over the DevTools Protocol, and works with your real tabs.

It ships as two things:

| | |
|---|---|
| `attach-cdp` | A dependency-free CLI: list tabs, evaluate JavaScript, navigate, click, screenshot, print to PDF, send raw CDP commands |
| `attach-cdp-mcp` | An [MCP](https://modelcontextprotocol.io) bridge that points [`chrome-devtools-mcp`](https://github.com/ChromeDevTools/chrome-devtools-mcp) at your running browser instead of a private one |

```console
$ attach-cdp list
  #0  Inbox (12) - you@example.com - Gmail
      https://mail.google.com/mail/u/0/#inbox
  #1  Pull requests · Dr-SherBaz/attach-cdp
      https://github.com/Dr-SherBaz/attach-cdp/pulls

$ attach-cdp eval "#0" "document.title"
Inbox (12) - you@example.com - Gmail
```

---

## Why this exists

Since Chrome 136, a browser started with the **default** user-data directory **refuses to serve the HTTP discovery endpoints** (`/json/version`, `/json/list`). They answer `404` — but the WebSocket debugger endpoint still works, and Chrome still writes the endpoint into `DevToolsActivePort` inside the profile.

That single detail breaks most "connect to my running browser" recipes, and it is the reason an agent ends up with a second, logged-out window. `attach-cdp` reads that file directly and never asks the HTTP endpoints for permission:

```
<user-data-dir>/DevToolsActivePort
  9222
  /devtools/browser/f1b4c93d-...
        │
        └──> ws://127.0.0.1:9222/devtools/browser/f1b4c93d-...
```

No dependencies. No bundled protocol typings. Just Node's built-in `WebSocket`.

## Requirements

- **Node.js 22 or newer** (uses the global `WebSocket`; no `ws` package)
- A Chromium-family browser with remote debugging enabled: Chrome, Chromium, Chrome Beta/Dev/Canary, Brave, Vivaldi or Edge
- For the MCP bridge only: `npx` (ships with Node) and network access to fetch `chrome-devtools-mcp`

## Enable remote debugging in your browser

Quit the browser **completely** first — launching it again while it is running ignores new flags.

```powershell
# Windows
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

```bash
# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222
# Linux
google-chrome --remote-debugging-port=9222
```

Chrome 144+ also lets you turn this on from `chrome://inspect/#remote-debugging` without restarting, if your build offers the toggle.

> Keep the debug port on `127.0.0.1`. Anyone who can reach it can drive your logged-in browser.

## Install

The package is not on npm yet, so install straight from the repository:

```bash
git clone https://github.com/Dr-SherBaz/attach-cdp.git
cd attach-cdp
npm link          # optional: puts attach-cdp and attach-cdp-mcp on your PATH
```

Without `npm link`, run the entry points directly:

```bash
node bin/attach-cdp.mjs doctor
node bin/attach-cdp-mcp.mjs
```

Or use `npx` against the repository, no clone needed:

```bash
npx github:Dr-SherBaz/attach-cdp doctor
```

## Quick start

```bash
attach-cdp doctor                 # is there a browser, can we talk to it?
attach-cdp list                   # what tabs are open?
attach-cdp text "#0" | head         # visible text of a tab
attach-cdp eval "#0" "document.title"
attach-cdp shot "#0" page.png --full
attach-cdp close iana.org         # close a tab by URL fragment
```

`doctor` is the command to run when anything looks wrong. It shows the endpoint it found, where it found it, the browser version, and every open tab.

## Commands

| Command | Description |
|---|---|
| `doctor` | Diagnose discovery, connection and tab access |
| `list` | List open tabs (`--json`, `--wide`) |
| `text <tab>` | Print the visible text of a tab |
| `eval <tab> <expression>` | Evaluate JavaScript (`--file`, `--stdin`, `--timeout`) |
| `call <tab> <Method> [json]` | Send a raw CDP command (`--params`, `--params-file`) |
| `nav <tab> <url>` | Navigate and wait for the document |
| `open <url>` | Open a new tab |
| `shot <tab> [file]` | Screenshot (`--full`, `--format png\|jpeg\|webp`, `--quality`) |
| `pdf <tab> [file]` | Print to PDF (`--landscape`) |
| `click <tab> <selector>` | Click the first element matching a CSS selector |
| `wait <tab> <expression>` | Poll until an expression is truthy (`--timeout`) |
| `close <tab>` | Close a tab |
| `mcp [args…]` | Start the MCP bridge (see below) |

### Selecting a tab

| Selector | Meaning |
|---|---|
| `#0` | Index from `attach-cdp list` |
| `1DD7F6D10528D482FB5CBDFF9E4BED9C` | Exact target id |
| `mail.google.com` | Case-insensitive substring of the URL |
| `Pull requests` | Case-insensitive substring of the title |

URL matches win over title matches; among equals, the first tab in browser order wins.

### Global options

| Option | Meaning |
|---|---|
| `--ws <url>` | Browser WebSocket endpoint (or `CDP_WS_ENDPOINT`) |
| `--port <n>` | Query `/json/version` on a port (or `CDP_PORT`) |
| `--json` | Machine-readable output |
| `--timeout <ms>` | Per-operation timeout (default 30000) |
| `--quiet` | Drop the "attached via …" note on stderr |
| `-h`, `-v` | Help, version |

Endpoint precedence: `--ws` → `--port` → `DevToolsActivePort` scan.

> On Windows PowerShell, JSON arguments lose their quotes on the way to a native executable. Use `--params-file params.json` instead of inlining JSON.

## MCP bridge for AI agents

The bridge exists to answer one question: *how do I let an agent use my logged-in browser?*

```bash
attach-cdp mcp            # or: attach-cdp-mcp
```

It resolves the endpoint, then execs `chrome-devtools-mcp --wsEndpoint <url>`. If no browser is found it falls back to launching a private profile (override with `ATTACH_CDP_FALLBACK_PROFILE`, disable with `--no-fallback` / `buildBridgeCommand({ fallback: false })`).

### OpenCode

`~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "servers": {
      "chrome-devtools": {
        "type": "local",
        "command": ["node", "C:\\path\\to\\attach-cdp\\bin\\attach-cdp-mcp.mjs"]
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add chrome-devtools -- node /path/to/attach-cdp/bin/attach-cdp-mcp.mjs
```

### Claude Desktop / Cursor / Zed

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["github:Dr-SherBaz/attach-cdp", "mcp"]
    }
  }
}
```

Restart the client after changing MCP configuration: the server reads the endpoint once, at startup.

## Programmatic API

```js
import { resolveEndpoint, Connection, listTargets, attach, evaluate } from "attach-cdp";

const endpoint = await resolveEndpoint();          // uses DevToolsActivePort
const conn = await Connection.open(endpoint.wsEndpoint);

const tabs = await listTargets(conn);
const session = await attach(conn, tabs[0].targetId);
console.log(await evaluate(conn, session, "document.title"));

conn.close();
```

Everything is exported from `src/index.js`: connection handling, target listing, evaluate, screenshots, PDF, navigation, clicking, polling and endpoint discovery.

## Security notes

Attaching means exactly what it sounds like: full control of a browser profile that is signed in to your accounts.

- Leave the debug port bound to `127.0.0.1`. Never publish it, never forward it to another machine.
- Any local process can use an open debug port — enable it for the session, not permanently.
- An agent wired to this bridge can read anything those tabs can read. Treat the MCP client with the same trust you give the browser.
- Prefer a dedicated browser profile when automating something sensitive, and use `--user-data-dir` for that profile.
- This project never sends your data anywhere. It talks to `127.0.0.1` and nothing else — the only network fetch in the codebase is `/json/version` on a local port, plus `npx` fetching `chrome-devtools-mcp`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `404` from `/json/version` | Chrome 136+ hides HTTP discovery for the default profile | Ignore it: `attach-cdp` uses `DevToolsActivePort`. Do not pass `--port` |
| `Nothing is listening on 127.0.0.1:9222` | Browser not started with the flag | Quit the browser fully, relaunch with `--remote-debugging-port=9222` |
| `No debug endpoint found` | No `DevToolsActivePort` in any known profile | Run `attach-cdp doctor` to see which directories were checked |
| Flag ignored, port still closed | Browser was already running when you relaunched it | Quit every window (and any background process) first |
| `Could not connect to ws://…` | Stale `DevToolsActivePort` from a crashed session | Restart the browser |
| MCP tools see `about:blank` only | Client launched its own browser | Point the client at `attach-cdp-mcp`, not `chrome-devtools-mcp` |
| Tab selector matches nothing | Duplicate tabs | Use `#N` from `attach-cdp list` |

Set `ATTACH_CDP_DEBUG=1` to print stack traces.

## Development

```bash
npm test              # unit tests + live integration tests (skipped when no browser)
npm run check         # syntax check the entry points
CDP_WS_ENDPOINT=... npm test   # force the integration tests against a known endpoint
```

Layout:

```
src/endpoint.js    discovery: profiles, DevToolsActivePort, ports
src/cdp.js         protocol client and page helpers
src/match.js       tab selection
src/cli.js         argument parsing and command dispatch
src/mcp-bridge.js  chrome-devtools-mcp launcher
bin/               the two entry points
test/              node:test suites
```

## License

MIT © Muhammad Sher Baz Ali
