#!/usr/bin/env node
import process from "node:process";
import { run } from "../src/cli.js";

// `attach-cdp list | head` should not crash with EPIPE.
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

process.exitCode = await run(process.argv.slice(2));
