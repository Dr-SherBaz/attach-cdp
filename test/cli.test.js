import test from "node:test";
import assert from "node:assert/strict";

import { parseArgv, UsageError } from "../src/cli.js";

test("parses a command with positionals", () => {
  const { positionals, options } = parseArgv(["eval", "lms3", "document.title"]);
  assert.deepEqual(positionals, ["eval", "lms3", "document.title"]);
  assert.deepEqual(options, {});
});

test("parses boolean flags anywhere", () => {
  const { positionals, options } = parseArgv(["list", "--json"]);
  assert.deepEqual(positionals, ["list"]);
  assert.equal(options.json, true);
});

test("parses value flags in both forms", () => {
  const { options } = parseArgv(["--timeout", "5000", "shot", "--format=jpeg"]);
  assert.equal(options.timeout, "5000");
  assert.equal(options.format, "jpeg");
});

test("keeps a value that equals a boolean flag name", () => {
  const { options } = parseArgv(["--file", "--json"]);
  assert.equal(options.file, "--json");
});

test("supports -- passthrough", () => {
  const { positionals } = parseArgv(["mcp", "--", "--slim", "--headless"]);
  assert.deepEqual(positionals, ["mcp", "--slim", "--headless"]);
});

test("maps -h and -v", () => {
  assert.equal(parseArgv(["-h"]).options.help, true);
  assert.equal(parseArgv(["-v"]).options.version, true);
});

test("flags without a value become true", () => {
  const { options } = parseArgv(["eval", "#0", "1+1", "--full"]);
  assert.equal(options.full, true);
});

test("UsageError carries exit code 2", () => {
  const error = new UsageError("bad usage");
  assert.equal(error.exitCode, 2);
});

test("a thrown usage error is reported by run()", async () => {
  const { run } = await import("../src/cli.js");
  const originalWrite = process.stderr.write.bind(process.stderr);
  let captured = "";
  process.stderr.write = (chunk) => {
    captured += chunk;
    return true;
  };
  try {
    const code = await run(["eval"]);
    assert.equal(code, 2);
    assert.match(captured, /eval needs a tab selector/);
  } finally {
    process.stderr.write = originalWrite;
  }
});
