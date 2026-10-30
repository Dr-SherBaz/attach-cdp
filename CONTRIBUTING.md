# Contributing

Thanks for taking a look. This project is deliberately small: zero runtime
dependencies and a preference for explicit code over clever abstractions.

## Getting set up

```bash
git clone https://github.com/Dr-SherBaz/attach-cdp.git
cd attach-cdp
npm test
```

There is nothing to install. The tests use the built-in `node:test` runner.

To run the live integration tests, start a browser with
`--remote-debugging-port=9222` (or set `CDP_WS_ENDPOINT`) before running
`npm test`. Without a browser those two tests skip.

## Ground rules

- **No runtime dependencies.** Node 22+ already provides `WebSocket`, `fetch`
  and a test runner. If you think a dependency is unavoidable, open an issue
  first.
- **Keep the CLI boring.** Predictable flags, `--json` on every command, exit
  code `0` on success, `1` on runtime failure, `2` on usage errors.
- **Test the failure path.** Discovery problems are the most common issue;
  error messages should say what is wrong and what to try next.
- **Never require the browser's HTTP discovery endpoints.** They are disabled
  for default profiles on modern Chrome. `DevToolsActivePort` is the source of
  truth.

## Pull requests

1. One topic per pull request.
2. `npm test` and `npm run check` must pass.
3. Update `README.md` when behaviour or flags change, and add a
   `CHANGELOG.md` entry under `## Unreleased`.
4. Describe the user-visible change, not just the diff.

## Commit messages

Conventional-ish and readable:

```
feat(cli): add --params-file for raw CDP calls
fix(endpoint): survive a stale DevToolsActivePort
docs(readme): explain the /json 404 on Chrome 136+
```

## Code style

- ES modules, two spaces, semicolons, double quotes.
- JSDoc on exported functions — it is the only type information in the repo.
- Prefer small pure functions in `src/` so they can be tested without a browser.

## License

By contributing you agree that your work is released under the MIT license.
