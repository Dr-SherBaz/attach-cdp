# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

Nothing yet.

## [0.1.0] - 2026-10-30

First release.

### Added

- Endpoint discovery from `DevToolsActivePort` for Chrome, Chromium, Chrome
  Beta/Dev/Canary, Brave, Vivaldi and Edge on Windows, macOS and Linux.
- Explicit endpoint overrides: `--ws` / `CDP_WS_ENDPOINT` and `--port` / `CDP_PORT`.
- Dependency-free CDP client built on Node 22's global `WebSocket`.
- CLI commands: `doctor`, `list`, `text`, `eval`, `call`, `nav`, `open`, `shot`,
  `pdf`, `click`, `wait`, `close`, `mcp`.
- Tab selection by index, target id, URL fragment or title fragment.
- `doctor` reports the endpoint, discovery source, browser version and open tabs.
- MCP bridge that connects `chrome-devtools-mcp` to a running browser, with a
  private-profile fallback when no endpoint is found.
- `--json` machine-readable output on every command.
- `--params` / `--params-file` for `call`, because PowerShell strips quotes from
  inline JSON arguments.
- `--wide` to disable URL shortening in `list`.
- UTF-8 BOM tolerance when reading expression and parameter files.
- Test suite on `node:test`, including opt-in live integration tests.
- CI matrix covering Ubuntu, Windows and macOS on Node 22 and 24.

### Fixed

- `list | head` no longer crashes with `EPIPE`.

[Unreleased]: https://github.com/Dr-SherBaz/attach-cdp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Dr-SherBaz/attach-cdp/releases/tag/v0.1.0
