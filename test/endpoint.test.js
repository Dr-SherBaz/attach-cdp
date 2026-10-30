import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  candidateProfileDirs,
  parseDevToolsActivePort,
  readEndpointFromDir,
  discoverLocalEndpoint,
  resolveEndpoint,
  resolveFromPort,
  EndpointError,
} from "../src/endpoint.js";

test("parseDevToolsActivePort parses a normal file", () => {
  const parsed = parseDevToolsActivePort("9222\n/devtools/browser/abc-123\n");
  assert.deepEqual(parsed, {
    port: 9222,
    wsPath: "/devtools/browser/abc-123",
    wsEndpoint: "ws://127.0.0.1:9222/devtools/browser/abc-123",
  });
});

test("parseDevToolsActivePort tolerates CRLF and a trailing newline", () => {
  const parsed = parseDevToolsActivePort("9333\r\n/devtools/browser/x\r\n");
  assert.equal(parsed?.wsEndpoint, "ws://127.0.0.1:9333/devtools/browser/x");
});

test("parseDevToolsActivePort rejects malformed content", () => {
  assert.equal(parseDevToolsActivePort(""), null);
  assert.equal(parseDevToolsActivePort("not-a-port\n/devtools/browser/x"), null);
  assert.equal(parseDevToolsActivePort("9222\nnot-a-path"), null);
  assert.equal(parseDevToolsActivePort("99999\n/devtools/browser/x"), null);
  assert.equal(parseDevToolsActivePort(undefined), null);
});

test("candidateProfileDirs lists Windows profiles first for win32", () => {
  const dirs = candidateProfileDirs({
    platform: "win32",
    home: "C:\\Users\\me",
    env: { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
  });
  assert.ok(dirs.length >= 4);
  assert.equal(
    dirs[0],
    path.win32.join("C:\\Users\\me\\AppData\\Local", "Google", "Chrome", "User Data")
  );
  assert.ok(dirs.some((dir) => dir.includes("Microsoft")));
});

test("candidateProfileDirs falls back to home when LOCALAPPDATA is missing", () => {
  const dirs = candidateProfileDirs({ platform: "win32", home: "C:\\Users\\me", env: {} });
  assert.ok(dirs[0].startsWith("C:\\Users\\me\\AppData\\Local"));
});

test("candidateProfileDirs handles macOS and Linux", () => {
  const mac = candidateProfileDirs({ platform: "darwin", home: "/Users/me", env: {} });
  assert.equal(mac[0], "/Users/me/Library/Application Support/Google/Chrome");

  const linux = candidateProfileDirs({ platform: "linux", home: "/home/me", env: {} });
  assert.equal(linux[0], "/home/me/.config/google-chrome");
  assert.ok(linux.some((dir) => dir.includes("microsoft-edge")));
});

test("readEndpointFromDir reads a fake profile directory", () => {
  const fakeFs = {
    existsSync: () => true,
    readFileSync: () => "9222\n/devtools/browser/fake\n",
  };
  const endpoint = readEndpointFromDir("/profile", { fs: fakeFs });
  assert.equal(endpoint?.wsEndpoint, "ws://127.0.0.1:9222/devtools/browser/fake");
  assert.equal(endpoint?.profileDir, "/profile");
});

test("readEndpointFromDir returns null when the file is missing", () => {
  const fakeFs = { existsSync: () => false, readFileSync: () => "" };
  assert.equal(readEndpointFromDir("/profile", { fs: fakeFs }), null);
});

test("discoverLocalEndpoint returns the first usable profile", () => {
  const fakeFs = {
    existsSync: (file) => file.includes("Chrome") || file.includes("Edge"),
    readFileSync: (file) =>
      file.includes("Chrome") ? "garbage\n/devtools/browser/x" : "9444\n/devtools/browser/edge",
  };
  const found = discoverLocalEndpoint({
    dirs: [path.join("/p", "Chrome"), path.join("/p", "Edge")],
    fs: fakeFs,
  });
  assert.equal(found?.port, 9444);
});

test("resolveEndpoint prefers an explicit WebSocket URL", async () => {
  const resolved = await resolveEndpoint({ ws: "ws://127.0.0.1:9222/devtools/browser/z" });
  assert.equal(resolved.source, "explicit");
  assert.equal(resolved.wsEndpoint, "ws://127.0.0.1:9222/devtools/browser/z");
});

test("resolveEndpoint reads CDP_WS_ENDPOINT from the environment", async () => {
  const resolved = await resolveEndpoint({
    env: { CDP_WS_ENDPOINT: "ws://127.0.0.1:1/devtools/browser/env" },
  });
  assert.equal(resolved.wsEndpoint, "ws://127.0.0.1:1/devtools/browser/env");
});

test("resolveEndpoint queries an explicit port over HTTP", async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, "http://127.0.0.1:9222/json/version");
    return {
      ok: true,
      status: 200,
      json: async () => ({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/http" }),
    };
  };
  const resolved = await resolveEndpoint({ port: "9222", fetchImpl, env: {} });
  assert.equal(resolved.source, "http");
  assert.equal(resolved.wsEndpoint, "ws://127.0.0.1:9222/devtools/browser/http");
});

test("resolveEndpoint explains a 404 from a modern default profile", async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({}) });
  await assert.rejects(
    () => resolveEndpoint({ port: 9222, fetchImpl, env: {} }),
    (error) => {
      assert.ok(error instanceof EndpointError);
      assert.match(error.message, /404/);
      assert.ok(error.hints.some((hint) => hint.includes("--ws")));
      return true;
    }
  );
});

test("resolveEndpoint reports a closed port", async () => {
  const fetchImpl = async () => {
    const error = new Error("connect ECONNREFUSED");
    error.code = "ECONNREFUSED";
    throw error;
  };
  await assert.rejects(
    () => resolveEndpoint({ port: 9222, fetchImpl, env: {} }),
    /Nothing is listening/
  );
});

test("resolveEndpoint fails with guidance when nothing is discoverable", async () => {
  await assert.rejects(
    () => resolveEndpoint({ dirs: ["/definitely/not/here"], env: {} }),
    (error) => {
      assert.ok(error instanceof EndpointError);
      assert.match(error.message, /No debug endpoint found/);
      assert.ok(error.hints.length > 0);
      return true;
    }
  );
});

test("resolveFromPort rejects a response without a debugger URL", async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({}) });
  await assert.rejects(() => resolveFromPort(9222, { fetchImpl }), /webSocketDebuggerUrl/);
});
