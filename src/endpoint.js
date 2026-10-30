/**
 * Locating a debuggable Chromium browser that is already running.
 *
 * Chromium refuses to serve the `/json/*` discovery endpoints for the default
 * user-data-dir (Chrome 136+), but it still writes `DevToolsActivePort` into
 * that profile and still accepts WebSocket connections. So the reliable path is:
 * read `DevToolsActivePort`, build `ws://127.0.0.1:<port><wsPath>`, connect.
 */

import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

export class EndpointError extends Error {
  constructor(message, hints = []) {
    super(message);
    this.name = "EndpointError";
    this.hints = hints;
  }
}

const WINDOWS_DIRS = [
  "Google/Chrome/User Data",
  "Google/Chrome Beta/User Data",
  "Google/Chrome Dev/User Data",
  "Google/Chrome SxS/User Data",
  "Chromium/User Data",
  "BraveSoftware/Brave-Browser/User Data",
  "Vivaldi/User Data",
  "Microsoft/Edge/User Data",
];

const MACOS_DIRS = [
  "Google/Chrome",
  "Google/Chrome Beta",
  "Google/Chrome Dev",
  "Google/Chrome Canary",
  "Chromium",
  "BraveSoftware/Brave-Browser",
  "Vivaldi",
  "Microsoft Edge",
];

const LINUX_DIRS = [
  ".config/google-chrome",
  ".config/google-chrome-beta",
  ".config/google-chrome-unstable",
  ".config/chromium",
  ".config/BraveSoftware/Brave-Browser",
  ".config/vivaldi",
  ".config/microsoft-edge",
];

/**
 * Chromium profile directories that may contain `DevToolsActivePort`.
 * Ordered from most common to least common.
 *
 * @param {{platform?: string, home?: string, env?: Record<string, string|undefined>}} [options]
 * @returns {string[]}
 */
export function candidateProfileDirs(options = {}) {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  const env = options.env ?? process.env;
  const dirs = [];

  if (platform === "win32") {
    const localAppData =
      env.LOCALAPPDATA || path.win32.join(home, "AppData", "Local");
    for (const rel of WINDOWS_DIRS) {
      dirs.push(path.win32.join(localAppData, ...rel.split("/")));
    }
  } else if (platform === "darwin") {
    const support = path.posix.join(home, "Library", "Application Support");
    for (const rel of MACOS_DIRS) dirs.push(path.posix.join(support, rel));
  } else {
    for (const rel of LINUX_DIRS) dirs.push(path.posix.join(home, rel));
  }

  return dirs;
}

/**
 * Parse the two-line `DevToolsActivePort` file.
 *
 * @param {string} text
 * @returns {{port: number, wsPath: string, wsEndpoint: string} | null}
 */
export function parseDevToolsActivePort(text) {
  if (typeof text !== "string") return null;
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const port = Number.parseInt(lines[0] ?? "", 10);
  const wsPath = lines[1] ?? "";
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return null;
  if (!wsPath.startsWith("/devtools/")) return null;
  return {
    port,
    wsPath,
    wsEndpoint: `ws://127.0.0.1:${port}${wsPath}`,
  };
}

/**
 * Read the endpoint for one profile directory.
 *
 * @param {string} dir
 * @param {{fs?: typeof fsSync}} [deps]
 * @returns {{port: number, wsPath: string, wsEndpoint: string, profileDir: string} | null}
 */
export function readEndpointFromDir(dir, deps = {}) {
  const fs = deps.fs ?? fsSync;
  const file = path.join(dir, "DevToolsActivePort");
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = parseDevToolsActivePort(fs.readFileSync(file, "utf8"));
    if (!parsed) return null;
    return { ...parsed, profileDir: dir };
  } catch {
    return null;
  }
}

/**
 * Find the first profile directory that advertises a debug endpoint.
 *
 * @param {{dirs?: string[], fs?: typeof fsSync}} [options]
 * @returns {{port: number, wsPath: string, wsEndpoint: string, profileDir: string} | null}
 */
export function discoverLocalEndpoint(options = {}) {
  const dirs = options.dirs ?? candidateProfileDirs();
  for (const dir of dirs) {
    const found = readEndpointFromDir(dir, { fs: options.fs });
    if (found) return found;
  }
  return null;
}

const GUIDANCE = [
  "Start Chrome with a debug port, e.g. chrome.exe --remote-debugging-port=9222",
  "or open chrome://inspect/#remote-debugging in Chrome and enable it there.",
  "Quit Chrome completely first: launching it again while it is running ignores new flags.",
];

/**
 * Resolve a WebSocket debugger URL for an already-running browser.
 *
 * Precedence: explicit ws URL -> explicit port (via /json/version) -> profile scan.
 *
 * @param {{ws?: string, port?: number|string, dirs?: string[], env?: Record<string,string|undefined>, fetchImpl?: typeof fetch, timeoutMs?: number}} [options]
 * @returns {Promise<{wsEndpoint: string, source: string, profileDir?: string, port?: number}>}
 */
export async function resolveEndpoint(options = {}) {
  const env = options.env ?? process.env;
  const explicitWs = options.ws ?? env.CDP_WS_ENDPOINT;
  if (explicitWs) {
    return { wsEndpoint: explicitWs, source: "explicit" };
  }

  const explicitPort = options.port ?? env.CDP_PORT;
  if (explicitPort !== undefined && explicitPort !== "") {
    const port = Number.parseInt(String(explicitPort), 10);
    if (!Number.isFinite(port) || port <= 0) {
      throw new EndpointError(`Invalid debug port: ${explicitPort}`, GUIDANCE);
    }
    return { ...(await resolveFromPort(port, options)), source: "http" };
  }

  const discovered = discoverLocalEndpoint({
    dirs: options.dirs ?? candidateProfileDirs(),
  });
  if (discovered) {
    return { ...discovered, source: "DevToolsActivePort" };
  }

  throw new EndpointError(
    "No debug endpoint found: no DevToolsActivePort file in any known Chromium profile.",
    GUIDANCE
  );
}

/**
 * Ask a debug port for its browser WebSocket URL.
 *
 * @param {number} port
 * @param {{fetchImpl?: typeof fetch, timeoutMs?: number}} [options]
 */
export async function resolveFromPort(port, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 4000;
  const url = `http://127.0.0.1:${port}/json/version`;

  let response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new EndpointError(
      `Nothing is listening on 127.0.0.1:${port} (${error?.code ?? error?.message}).`,
      GUIDANCE
    );
  }

  if (!response.ok) {
    throw new EndpointError(
      `127.0.0.1:${port} answered ${response.status} for /json/version. ` +
        "Recent Chromium hides the HTTP discovery endpoints for the default profile.",
      [
        "Pass the WebSocket URL directly with --ws <url> (read it from <profile>/DevToolsActivePort).",
        ...GUIDANCE,
      ]
    );
  }

  const body = await response.json();
  if (!body?.webSocketDebuggerUrl) {
    throw new EndpointError(
      `127.0.0.1:${port} responded but exposed no webSocketDebuggerUrl.`,
      GUIDANCE
    );
  }
  return { wsEndpoint: body.webSocketDebuggerUrl, port };
}
