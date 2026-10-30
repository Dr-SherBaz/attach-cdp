/**
 * Bridge between an MCP client and a Chromium instance that is already running.
 *
 * The heavy lifting (tools, snapshots, network inspection) is done by
 * chrome-devtools-mcp. This module only solves the part it cannot do on its own
 * here: finding the WebSocket endpoint of a browser that is already open and
 * connecting to it instead of launching a private one.
 */

import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

import { EndpointError, resolveEndpoint } from "./endpoint.js";

export const DEFAULT_MCP_PACKAGE = "chrome-devtools-mcp@latest";

function defaultFallbackProfile() {
  return path.join(os.homedir(), ".attach-cdp", "chrome-profile");
}

/**
 * @typedef {object} BridgeOptions
 * @property {string[]} [args] extra arguments forwarded to chrome-devtools-mcp
 * @property {string} [mcppackage] npm package spec to run
 * @property {string} [fallbackUserDataDir]
 * @property {boolean} [fallback] launch a private profile when no endpoint is found
 * @property {boolean} [quiet]
 * @property {typeof resolveEndpoint} [resolver] injectable for tests
 */

/**
 * @param {BridgeOptions} [options]
 * @returns {Promise<{command: string, args: string[], attached: boolean, wsEndpoint?: string}>}
 */
export async function buildBridgeCommand(options = {}) {
  const pkg = options.mcppackage ?? process.env.ATTACH_CDP_MCP_PACKAGE ?? DEFAULT_MCP_PACKAGE;
  const base = ["-y", pkg, "--no-usage-statistics"];
  const extra = options.args ?? [];
  const fallbackEnabled = options.fallback !== false;
  const resolve = options.resolver ?? resolveEndpoint;

  try {
    const endpoint = await resolve({
      ws: options.ws ?? process.env.CDP_WS_ENDPOINT,
      port: options.port ?? process.env.CDP_PORT,
    });
    return {
      command: "npx",
      args: [...base, "--wsEndpoint", endpoint.wsEndpoint, ...extra],
      attached: true,
      wsEndpoint: endpoint.wsEndpoint,
    };
  } catch (error) {
    if (!fallbackEnabled) throw error;
    if (!(error instanceof EndpointError)) throw error;

    const userDataDir =
      options.fallbackUserDataDir ?? process.env.ATTACH_CDP_FALLBACK_PROFILE ?? defaultFallbackProfile();
    return {
      command: "npx",
      args: [...base, "--userDataDir", userDataDir, ...extra],
      attached: false,
    };
  }
}

/**
 * Replace the current process with chrome-devtools-mcp.
 *
 * @param {string[]} args arguments after `--`, forwarded verbatim
 * @param {BridgeOptions} [options]
 */
export async function runMcpBridge(args = [], options = {}) {
  const plan = await buildBridgeCommand({ ...options, args });

  const log = (message) => {
    if (!options.quiet) process.stderr.write(`[attach-cdp] ${message}\n`);
  };

  if (plan.attached) {
    log(`attaching to running browser: ${plan.wsEndpoint}`);
  } else {
    log("no running browser found, starting a private automation profile instead");
  }

  const child = spawn(
    process.platform === "win32" ? "npx.cmd" : plan.command,
    plan.args,
    {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    }
  );

  const forward = (signal) => () => {
    try {
      child.kill(signal);
    } catch {}
  };
  process.on("SIGINT", forward("SIGINT"));
  process.on("SIGTERM", forward("SIGTERM"));

  return await new Promise((resolve) => {
    child.on("error", (error) => {
      process.stderr.write(`[attach-cdp] failed to start ${plan.command}: ${error.message}\n`);
      resolve(1);
    });
    child.on("exit", (code, signal) => resolve(signal ? 1 : code ?? 0));
  });
}
