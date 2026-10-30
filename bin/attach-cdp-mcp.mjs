#!/usr/bin/env node
/**
 * MCP stdio server entry point.
 *
 * Point an MCP client at this script and it will bridge every tool call to the
 * Chromium instance you already have open, with your existing logins.
 */
import process from "node:process";
import { runMcpBridge } from "../src/mcp-bridge.js";

const separator = process.argv.indexOf("--");
const forwarded = separator === -1 ? [] : process.argv.slice(separator + 1);

process.exitCode = await runMcpBridge(forwarded);
