/**
 * Live integration test. Runs only when a debuggable Chromium is available
 * (CDP_WS_ENDPOINT, CDP_PORT, or a DevToolsActivePort file). Otherwise skipped.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { resolveEndpoint } from "../src/endpoint.js";
import { Connection, attach, evaluate, listTargets, version } from "../src/cdp.js";
import { matchTarget } from "../src/match.js";

async function connectOrSkip(t) {
  let endpoint;
  try {
    endpoint = await resolveEndpoint({});
  } catch {
    t.skip("no debuggable browser found; set CDP_WS_ENDPOINT to run this test");
    return null;
  }
  try {
    return { conn: await Connection.open(endpoint.wsEndpoint), endpoint };
  } catch (error) {
    t.skip(`browser endpoint is not reachable: ${error.message}`);
    return null;
  }
}

test("connects to the running browser and reports its version", async (t) => {
  const live = await connectOrSkip(t);
  if (!live) return;
  try {
    const info = await version(live.conn);
    assert.ok(info.product.includes("/"), "product string looks like a browser");
    assert.ok(info.protocolVersion.length > 0);
  } finally {
    live.conn.close();
  }
});

test("lists tabs and evaluates JavaScript in the first one", async (t) => {
  const live = await connectOrSkip(t);
  if (!live) return;
  try {
    const targets = await listTargets(live.conn);
    if (!targets.length) {
      t.skip("browser has no page targets");
      return;
    }
    const target = matchTarget(targets, "#0");
    const sessionId = await attach(live.conn, target.targetId);
    const sum = await evaluate(live.conn, sessionId, "1 + 1");
    assert.equal(sum, 2);
    const hasDocument = await evaluate(live.conn, sessionId, "typeof document");
    assert.equal(hasDocument, "object");
  } finally {
    live.conn.close();
  }
});
