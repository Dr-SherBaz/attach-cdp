/**
 * Command line interface for attach-cdp.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import * as cdp from "./cdp.js";
import { matchTarget, describeTargets, TargetNotFoundError } from "./match.js";
import { EndpointError, candidateProfileDirs, resolveEndpoint } from "./endpoint.js";

const BOOLEAN_FLAGS = new Set([
  "json",
  "full",
  "help",
  "version",
  "stdin",
  "include-undefined",
  "background",
  "landscape",
  "quiet",
  "wide",
]);

const USAGE = `attach-cdp - drive a Chrome that is already running, from the terminal

Usage
  attach-cdp <command> [arguments] [options]

Commands
  doctor                      Diagnose discovery, connection and tab access
  list                        List open tabs
  text <tab>                  Print the visible text of a tab
  eval <tab> <expression>     Evaluate JavaScript in a tab
  call <tab> <Method> [json]  Send a raw DevTools protocol command
  nav <tab> <url>             Navigate a tab and wait for the document
  open <url>                  Open a new tab
  shot <tab> [file]           Screenshot a tab (png by default)
  pdf <tab> [file]            Print a tab to PDF
  click <tab> <selector>      Click the first element matching a CSS selector
  wait <tab> <expression>     Poll until an expression is truthy
  close <tab>                 Close a tab
  mcp [args...]               Start the chrome-devtools-mcp bridge on this browser

Tab selectors
  #0            tab index from \`attach-cdp list\`
  <targetId>    exact target id
  lms3.aiou     substring of the URL (case-insensitive)
  AAGHI_LMS     substring of the title (case-insensitive)

Options
  --ws <url>      Browser WebSocket endpoint (or env CDP_WS_ENDPOINT)
  --port <n>      Debug port to query via /json/version (or env CDP_PORT)
  --json          Machine readable output
  --timeout <ms>  Per-operation timeout (default 30000)
  --full          Full-page screenshot
  --format <f>    png | jpeg | webp (screenshot)
  --quality <n>   jpeg/webp quality, 0-100
  --file <path>   Read the expression from a file
  --stdin         Read the expression from stdin
  --params <json> JSON parameters for the call command
  --params-file <path>  Read call parameters from a file
  --quiet         Suppress the trailing session note on stderr
  --wide          Do not shorten long URLs in tab lists
  -h, --help      Show this help
  -v, --version   Show the version

Examples
  attach-cdp doctor
  attach-cdp list
  attach-cdp eval lms3.aiou "document.title"
  attach-cdp shot #0 page.png --full
  attach-cdp call lms3.aiou Runtime.evaluate '{"expression":"1+1","returnByValue":true}'
`;

/** Split argv into positionals and options. */
export function parseArgv(argv) {
  const positionals = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (token.startsWith("--")) {
      const body = token.slice(2);
      const equals = body.indexOf("=");
      if (equals !== -1) {
        options[body.slice(0, equals)] = body.slice(equals + 1);
        continue;
      }
      if (BOOLEAN_FLAGS.has(body)) {
        options[body] = true;
        continue;
      }
      const next = argv[index + 1];
      if (next === undefined || (next.startsWith("--") && !BOOLEAN_FLAGS.has(next.slice(2)))) {
        options[body] = true;
      } else {
        options[body] = next;
        index += 1;
      }
      continue;
    }

    if (token === "-h") {
      options.help = true;
      continue;
    }
    if (token === "-v") {
      options.version = true;
      continue;
    }

    positionals.push(token);
  }

  return { positionals, options };
}

export function packageVersion() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8"));
  return pkg.version;
}

const URL_DISPLAY_LIMIT = 160;

export function shortenUrl(url, limit = URL_DISPLAY_LIMIT) {
  if (!url || url.length <= limit) return url;
  return `${url.slice(0, limit - 1)}…`;
}

function formatTable(targets, selectedId, options = {}) {
  return targets
    .map((target, index) => {
      const marker = target.targetId === selectedId ? "*" : " ";
      const title = (target.title || "(untitled)").replace(/\s+/g, " ").trim();
      const url = options.wide ? target.url : shortenUrl(target.url);
      return `${marker} #${index}  ${title}\n      ${url}`;
    })
    .join("\n");
}

function readTextFile(file) {
  // Strip a UTF-8 BOM: Windows editors and PowerShell add one by default.
  return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
}

async function readExpression(positionals, options) {
  if (options.stdin) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "");
  }
  if (typeof options.file === "string") {
    return readTextFile(options.file);
  }
  return positionals.join(" ");
}

/** Open a connection, run the action, always close. */
async function withBrowser(options, action) {
  const endpoint = await resolveEndpoint({
    ws: typeof options.ws === "string" ? options.ws : undefined,
    port: typeof options.port === "string" || typeof options.port === "number" ? options.port : undefined,
  });

  const conn = await cdp.Connection.open(endpoint.wsEndpoint);
  try {
    return await action(conn, endpoint);
  } finally {
    conn.close();
  }
}

async function withPage(options, selector, action) {
  return withBrowser(options, async (conn, endpoint) => {
    const targets = await cdp.listTargets(conn);
    let target;
    try {
      target = matchTarget(targets, selector);
    } catch (error) {
      if (error instanceof TargetNotFoundError) {
        throw new Error(
          `${error.message}\n\nOpen tabs:\n${
            error.candidates.length ? describeTargets(error.candidates) : "  (none)"
          }`
        );
      }
      throw error;
    }
    const sessionId = await cdp.attach(conn, target.targetId);
    const result = await action({ conn, sessionId, target, targets, endpoint });
    return result;
  });
}

function note(options, message) {
  if (!options.quiet) process.stderr.write(`${message}\n`);
}

function print(value, options) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  if (typeof value === "string") {
    process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export async function main(argv = process.argv.slice(2)) {
  const { positionals, options } = parseArgv(argv);
  const command = positionals.shift();

  if (options.version) {
    print(packageVersion(), options);
    return 0;
  }
  if (options.help || !command) {
    process.stdout.write(USAGE);
    return command ? 0 : 2;
  }

  switch (command) {
    case "doctor":
      return doctor(options);

    case "list":
    case "tabs": {
      return withBrowser(options, async (conn, endpoint) => {
        const targets = await cdp.listTargets(conn);
        if (options.json) {
          print(
            targets.map((target, index) => ({ index, ...target })),
            options
          );
        } else {
          note(options, `attached via ${endpoint.wsEndpoint}`);
          print(formatTable(targets, null, options), options);
          note(options, `${targets.length} tab(s)`);
        }
        return 0;
      });
    }

    case "eval": {
      const selector = positionals.shift();
      if (!selector) throw new UsageError("eval needs a tab selector");
      const expression = await readExpression(positionals, options);
      if (!expression.trim()) throw new UsageError("eval needs a JavaScript expression");

      return withPage(options, selector, async ({ conn, sessionId, target }) => {
        const value = await cdp.evaluate(conn, sessionId, expression, {
          timeoutMs: Number(options.timeout) || undefined,
        });
        if (value === undefined && !options["include-undefined"]) {
          note(options, `undefined (${target.title})`);
          return 0;
        }
        print(value, options);
        return 0;
      });
    }

    case "call": {
      const selector = positionals.shift();
      const method = positionals.shift();
      if (!selector || !method) throw new UsageError("call needs <tab> and <Method>");
      let params = {};
      let rawParams = positionals.join(" ");
      if (typeof options.params === "string") rawParams = options.params;
      if (typeof options["params-file"] === "string") {
        rawParams = readTextFile(options["params-file"]);
      }
      if (rawParams) {
        try {
          params = JSON.parse(rawParams);
        } catch (error) {
          throw new UsageError(
            `Parameters must be valid JSON: ${error.message}. ` +
              "If your shell strips quotes, put the JSON in a file and pass --params-file <path>."
          );
        }
      }

      return withPage(options, selector, async ({ conn, sessionId }) => {
        const result = await conn.send(method, params, sessionId);
        print(result, options);
        return 0;
      });
    }

    case "text": {
      const selector = positionals.shift();
      if (!selector) throw new UsageError("text needs a tab selector");
      return withPage(options, selector, async ({ conn, sessionId }) => {
        print(await cdp.innerText(conn, sessionId), options);
        return 0;
      });
    }

    case "nav":
    case "navigate": {
      const selector = positionals.shift();
      const url = positionals.shift();
      if (!selector || !url) throw new UsageError("nav needs <tab> and <url>");
      return withPage(options, selector, async ({ conn, sessionId, target }) => {
        await cdp.navigate(conn, sessionId, url, {
          timeoutMs: Number(options.timeout) || undefined,
        });
        const finalUrl = await cdp.evaluate(conn, sessionId, "location.href");
        if (options.json) print({ from: target.url, to: finalUrl }, options);
        else note(options, `${finalUrl}`);
        return 0;
      });
    }

    case "open": {
      const url = positionals.shift();
      if (!url) throw new UsageError("open needs a URL");
      return withBrowser(options, async (conn) => {
        const { targetId } = await cdp.createTarget(conn, url);
        print({ targetId, url }, options);
        return 0;
      });
    }

    case "shot":
    case "screenshot": {
      const selector = positionals.shift();
      if (!selector) throw new UsageError("shot needs a tab selector");
      const file = positionals.shift();
      const format = options.format ?? "png";
      return withPage(options, selector, async ({ conn, sessionId }) => {
        const buffer = await cdp.screenshot(conn, sessionId, {
          format,
          fullPage: Boolean(options.full),
          quality: Number(options.quality) || undefined,
        });
        const out = path.resolve(file ?? `attach-cdp-${Date.now()}.${format}`);
        fs.writeFileSync(out, buffer);
        print({ file: out, bytes: buffer.length, format, fullPage: Boolean(options.full) }, options);
        return 0;
      });
    }

    case "pdf": {
      const selector = positionals.shift();
      if (!selector) throw new UsageError("pdf needs a tab selector");
      const file = positionals.shift();
      return withPage(options, selector, async ({ conn, sessionId }) => {
        const buffer = await cdp.pdf(conn, sessionId, {
          landscape: Boolean(options.landscape),
        });
        const out = path.resolve(file ?? `attach-cdp-${Date.now()}.pdf`);
        fs.writeFileSync(out, buffer);
        print({ file: out, bytes: buffer.length }, options);
        return 0;
      });
    }

    case "click": {
      const selector = positionals.shift();
      const css = positionals.shift();
      if (!selector || !css) throw new UsageError("click needs <tab> and a CSS selector");
      return withPage(options, selector, async ({ conn, sessionId }) => {
        await cdp.click(conn, sessionId, css);
        print({ clicked: css }, options);
        return 0;
      });
    }

    case "wait": {
      const selector = positionals.shift();
      const expression = positionals.shift();
      if (!selector || !expression) throw new UsageError("wait needs <tab> and an expression");
      return withPage(options, selector, async ({ conn, sessionId }) => {
        await cdp.waitFor(conn, sessionId, expression, {
          timeoutMs: Number(options.timeout) || undefined,
        });
        print({ ok: true }, options);
        return 0;
      });
    }

    case "close": {
      const selector = positionals.shift();
      if (!selector) throw new UsageError("close needs a tab selector");
      return withBrowser(options, async (conn) => {
        const target = matchTarget(await cdp.listTargets(conn), selector);
        await cdp.closeTarget(conn, target.targetId);
        print({ closed: target.targetId, title: target.title }, options);
        return 0;
      });
    }

    case "mcp": {
      const { runMcpBridge } = await import("./mcp-bridge.js");
      return runMcpBridge(positionals.concat(options.extraArgs ?? []));
    }

    default:
      throw new UsageError(`Unknown command: ${command}`);
  }
}

async function doctor(options) {
  const report = {
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    profileDirs: candidateProfileDirs(),
    endpoint: null,
    source: null,
    browser: null,
    tabs: [],
    problems: [],
  };

  try {
    const endpoint = await resolveEndpoint({
      ws: typeof options.ws === "string" ? options.ws : undefined,
      port: typeof options.port === "string" ? options.port : undefined,
    });
    report.endpoint = endpoint.wsEndpoint;
    report.source = endpoint.source;
    if (endpoint.profileDir) report.profileDir = endpoint.profileDir;

    const conn = await cdp.Connection.open(endpoint.wsEndpoint);
    try {
      const version = await cdp.version(conn);
      report.browser = `${version.product} (${version.protocolVersion})`;
      const targets = await cdp.listTargets(conn);
      report.tabs = targets.map((target, index) => ({
        index,
        title: target.title,
        url: target.url,
      }));
    } finally {
      conn.close();
    }
  } catch (error) {
    report.problems.push(error.message);
    if (error.hints?.length) report.problems.push(...error.hints);
  }

  if (options.json) {
    print(report, options);
    return report.problems.length ? 1 : 0;
  }

  process.stdout.write(
    [
      `node        ${report.node} (${report.platform})`,
      `endpoint    ${report.endpoint ?? "(not found)"}`,
      `source      ${report.source ?? "-"}`,
      `browser     ${report.browser ?? "(not connected)"}`,
      `tabs        ${report.tabs.length}`,
      "",
      "profile dirs checked:",
      ...report.profileDirs.map((dir) => `  ${dir}`),
    ].join("\n") + "\n"
  );

  if (report.tabs.length) {
    process.stdout.write(
      `\nopen tabs:\n${report.tabs.map((tab) => `  #${tab.index}  ${tab.title}\n      ${tab.url}`).join("\n")}\n`
    );
  }
  if (report.problems.length) {
    process.stdout.write(`\nproblems:\n${report.problems.map((line) => `  ${line}`).join("\n")}\n`);
    return 1;
  }
  return 0;
}

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
    this.exitCode = 2;
  }
}

/**
 * Entry point used by bin/attach-cdp.mjs.
 * @param {string[]} argv
 */
export async function run(argv = process.argv.slice(2)) {
  try {
    return await main(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`attach-cdp: ${error.message}\n\n${USAGE}`);
      return 2;
    }
    if (error instanceof EndpointError) {
      process.stderr.write(`attach-cdp: ${error.message}\n`);
      for (const hint of error.hints) process.stderr.write(`  - ${hint}\n`);
      return 1;
    }
    process.stderr.write(`attach-cdp: ${error.message}\n`);
    if (process.env.ATTACH_CDP_DEBUG) process.stderr.write(`${error.stack}\n`);
    return 1;
  }
}
