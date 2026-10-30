/**
 * A very small Chrome DevTools Protocol client built on the WebSocket global
 * that ships with Node.js 22+. No dependencies, no bundled protocol typings.
 */

export class CdpError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "CdpError";
    this.details = details;
  }
}

/**
 * One connection to a browser-level DevTools endpoint.
 */
export class Connection {
  /** @param {WebSocket} ws */
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    /** @type {Map<number, {resolve: Function, reject: Function}>} */
    this.pending = new Map();
    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();

    ws.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          reject(new CdpError(`${message.error.message} (${message.error.code})`, message.error));
        } else {
          resolve(message.result);
        }
        return;
      }
      if (message.method) {
        const handlers = this.listeners.get(message.method);
        if (handlers) for (const handler of handlers) handler(message.params, message.sessionId);
      }
    });

    ws.addEventListener("close", () => {
      for (const { reject } of this.pending.values()) {
        reject(new CdpError("Connection closed before the command completed."));
      }
      this.pending.clear();
    });
  }

  /**
   * @param {string} wsEndpoint
   * @param {{timeoutMs?: number}} [options]
   */
  static async open(wsEndpoint, options = {}) {
    const timeoutMs = options.timeoutMs ?? 10000;
    const ws = new WebSocket(wsEndpoint);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {}
        reject(
          new CdpError(
            `Timed out after ${timeoutMs}ms connecting to ${wsEndpoint}. ` +
              "Is the browser still running with remote debugging enabled?"
          )
        );
      }, timeoutMs);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new CdpError(`Could not connect to ${wsEndpoint}.`));
      }, { once: true });
    });
    return new Connection(ws);
  }

  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(handler);
    return () => this.listeners.get(method)?.delete(handler);
  }

  /**
   * @param {string} method
   * @param {Record<string, unknown>} [params]
   * @param {string} [sessionId]
   */
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

/** Browser version information. */
export async function version(conn) {
  return conn.send("Browser.getVersion");
}

/** Every page-like target in the browser. */
export async function listTargets(conn) {
  const { targetInfos } = await conn.send("Target.getTargets");
  return targetInfos.filter(
    (target) => target.type === "page" && !target.url.startsWith("devtools://")
  );
}

/**
 * Attach a flattened session to a target.
 * @param {Connection} conn
 * @param {string} targetId
 */
export async function attach(conn, targetId) {
  const { sessionId } = await conn.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  return sessionId;
}

/**
 * Evaluate an expression in a page and return its value by value.
 *
 * @param {Connection} conn
 * @param {string} sessionId
 * @param {string} expression
 * @param {{awaitPromise?: boolean, timeoutMs?: number}} [options]
 */
export async function evaluate(conn, sessionId, expression, options = {}) {
  const { result, exceptionDetails } = await conn.send(
    "Runtime.evaluate",
    {
      expression,
      returnByValue: true,
      awaitPromise: options.awaitPromise ?? true,
      userGesture: true,
      timeout: options.timeoutMs,
      includeCommandLineAPI: true,
    },
    sessionId
  );

  if (exceptionDetails) {
    const description =
      exceptionDetails.exception?.description ?? exceptionDetails.text ?? "Evaluation failed";
    throw new CdpError(description, exceptionDetails);
  }
  if (result?.type === "undefined") return undefined;
  if (result?.unserializableValue !== undefined) return result.unserializableValue;
  return result?.value;
}

/**
 * Visible text of the document body.
 * @param {Connection} conn
 * @param {string} sessionId
 */
export async function innerText(conn, sessionId) {
  return evaluate(conn, sessionId, "document.body ? document.body.innerText : ''");
}

/**
 * @param {Connection} conn
 * @param {string} sessionId
 * @param {{format?: "png"|"jpeg"|"webp", quality?: number, fullPage?: boolean}} [options]
 * @returns {Promise<Buffer>}
 */
export async function screenshot(conn, sessionId, options = {}) {
  const format = options.format ?? "png";
  const params = { format, captureBeyondViewport: true };

  if (format === "jpeg" || format === "webp") {
    params.quality = options.quality ?? 80;
  }

  if (options.fullPage) {
    const metrics = await conn.send("Page.getLayoutMetrics", {}, sessionId);
    const size = metrics.cssContentSize ?? metrics.contentSize;
    params.clip = {
      x: 0,
      y: 0,
      width: Math.ceil(size.width),
      height: Math.ceil(size.height),
      scale: 1,
    };
    params.captureBeyondViewport = true;
  }

  const { data } = await conn.send("Page.captureScreenshot", params, sessionId);
  return Buffer.from(data, "base64");
}

/**
 * @param {Connection} conn
 * @param {string} sessionId
 * @param {string} url
 * @param {{timeoutMs?: number}} [options]
 */
export async function navigate(conn, sessionId, url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30000;
  const { frameId, errorText } = await conn.send("Page.navigate", { url }, sessionId);
  if (errorText) throw new CdpError(`Navigation failed: ${errorText}`);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await evaluate(conn, sessionId, "document.readyState").catch(() => "loading");
    if (ready === "complete" || ready === "interactive") return { frameId };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { frameId };
}

/**
 * Print the page to PDF (requires headless Chrome for reliable output).
 *
 * @param {Connection} conn
 * @param {string} sessionId
 * @param {{landscape?: boolean, printBackground?: boolean, paperWidth?: number, paperHeight?: number}} [options]
 * @returns {Promise<Buffer>}
 */
export async function pdf(conn, sessionId, options = {}) {
  const { data } = await conn.send(
    "Page.printToPDF",
    {
      landscape: options.landscape ?? false,
      printBackground: options.printBackground ?? true,
      paperWidth: options.paperWidth ?? 8.27,
      paperHeight: options.paperHeight ?? 11.69,
    },
    sessionId
  );
  return Buffer.from(data, "base64");
}

/**
 * Open a new tab.
 * @param {Connection} conn
 * @param {string} [url]
 */
export async function createTarget(conn, url = "about:blank") {
  return conn.send("Target.createTarget", { url });
}

/**
 * Close a tab.
 * @param {Connection} conn
 * @param {string} targetId
 */
export async function closeTarget(conn, targetId) {
  return conn.send("Target.closeTarget", { targetId });
}

/**
 * Poll a page until a predicate holds.
 *
 * @param {Connection} conn
 * @param {string} sessionId
 * @param {string} expression must evaluate to a truthy value
 * @param {{timeoutMs?: number, intervalMs?: number}} [options]
 */
export async function waitFor(conn, sessionId, expression, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15000;
  const intervalMs = options.intervalMs ?? 150;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = await evaluate(conn, sessionId, expression).catch(() => false);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new CdpError(`Timed out after ${timeoutMs}ms waiting for: ${expression}`);
}

/**
 * Click an element selected by a CSS selector, scrolling it into view first.
 *
 * @param {Connection} conn
 * @param {string} sessionId
 * @param {string} selector
 */
export async function click(conn, sessionId, selector) {
  return evaluate(
    conn,
    sessionId,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("No element matches " + ${JSON.stringify(selector)});
      el.scrollIntoView({ block: "center", inline: "center" });
      el.click();
      return true;
    })()`
  );
}
