import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

import { buildBridgeCommand, DEFAULT_MCP_PACKAGE } from "../src/mcp-bridge.js";
import { EndpointError } from "../src/endpoint.js";

test("uses --wsEndpoint when a browser endpoint resolves", async () => {
  const plan = await buildBridgeCommand({
    resolver: async () => ({ wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/abc", source: "test" }),
    args: ["--slim"],
  });
  assert.equal(plan.attached, true);
  assert.equal(plan.command, "npx");
  assert.deepEqual(plan.args, [
    "-y",
    DEFAULT_MCP_PACKAGE,
    "--no-usage-statistics",
    "--wsEndpoint",
    "ws://127.0.0.1:9222/devtools/browser/abc",
    "--slim",
  ]);
});

test("falls back to a private profile when nothing is found", async () => {
  const plan = await buildBridgeCommand({
    resolver: async () => {
      throw new EndpointError("no endpoint");
    },
    fallbackUserDataDir: path.join(os.tmpdir(), "attach-cdp-profile"),
  });
  assert.equal(plan.attached, false);
  assert.ok(plan.args.includes("--userDataDir"));
  assert.ok(plan.args.includes(path.join(os.tmpdir(), "attach-cdp-profile")));
});

test("honours a custom package spec", async () => {
  const plan = await buildBridgeCommand({
    resolver: async () => ({ wsEndpoint: "ws://x/y", source: "test" }),
    mcppackage: "chrome-devtools-mcp@1.0.0",
  });
  assert.ok(plan.args.includes("chrome-devtools-mcp@1.0.0"));
});

test("rethrows when fallback is disabled", async () => {
  await assert.rejects(
    () =>
      buildBridgeCommand({
        resolver: async () => {
          throw new EndpointError("no endpoint");
        },
        fallback: false,
      }),
    /no endpoint/
  );
});

test("rethrows non-endpoint errors instead of hiding them", async () => {
  await assert.rejects(
    () =>
      buildBridgeCommand({
        resolver: async () => {
          throw new TypeError("boom");
        },
      }),
    /boom/
  );
});
