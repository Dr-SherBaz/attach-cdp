# Security policy

## What this tool can do

`attach-cdp` connects to a Chromium browser that is running with remote
debugging enabled. That connection is equivalent to full control of the
browser profile: reading pages, cookies via JavaScript, form values, and
anything the profile is signed in to.

Treat the debug port as a local credential:

- Bind it to `127.0.0.1` only. Never expose it through a tunnel or a proxy.
- Enable it for the session you need, not permanently.
- Use a dedicated browser profile when automating something sensitive.

The tool itself does not phone home. The only outbound requests are:

1. `http://127.0.0.1:<port>/json/version` when you explicitly pass `--port`.
2. `npx` fetching `chrome-devtools-mcp` when you use the MCP bridge.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability.

- Use GitHub's private "Report a vulnerability" flow on the repository's
  Security tab, or
- email the maintainer listed in `package.json`.

Include the version, the command you ran, and what you expected to happen.
Expect an acknowledgement within a few days; fixes are released as patch
versions with a note in `CHANGELOG.md`.

## Supported versions

The latest released minor version receives security fixes.
