/**
 * Selecting a tab out of a browser that may have dozens open.
 *
 * Accepted selectors:
 * - `#2`            zero-based index from `attach-cdp list`
 * - `<targetId>`    exact target id
 * - `lms3.aiou`     case-insensitive substring of the URL
 * - `AAGHI_LMS`     case-insensitive substring of the title
 */

export class TargetNotFoundError extends Error {
  constructor(message, candidates = []) {
    super(message);
    this.name = "TargetNotFoundError";
    this.candidates = candidates;
  }
}

/** @param {Array<{targetId: string, title: string, url: string}>} targets */
export function describeTargets(targets) {
  return targets
    .map((target, index) => {
      const title = target.title?.trim() || "(untitled)";
      return `  #${index}  ${title}\n      ${target.url}`;
    })
    .join("\n");
}

/**
 * @param {Array<{targetId: string, title?: string, url: string}>} targets
 * @param {string} selector
 */
export function matchTarget(targets, selector) {
  if (!targets.length) {
    throw new TargetNotFoundError("The browser has no page targets to attach to.");
  }
  if (typeof selector !== "string" || selector.trim() === "") {
    throw new TargetNotFoundError(
      "A tab selector is required, e.g. `#0`, a URL fragment, or a page title.",
      targets
    );
  }

  const needle = selector.trim();

  const byId = targets.find((target) => target.targetId === needle);
  if (byId) return byId;

  const indexMatch = /^#(\d+)$/.exec(needle);
  if (indexMatch) {
    const index = Number.parseInt(indexMatch[1], 10);
    const target = targets[index];
    if (!target) {
      throw new TargetNotFoundError(
        `No tab at index #${index}; the browser has ${targets.length} tab(s).`,
        targets
      );
    }
    return target;
  }

  const lowered = needle.toLowerCase();
  const byUrl = targets.find((target) => target.url?.toLowerCase().includes(lowered));
  if (byUrl) return byUrl;

  const byTitle = targets.find((target) => target.title?.toLowerCase().includes(lowered));
  if (byTitle) return byTitle;

  throw new TargetNotFoundError(
    `No open tab matches "${selector}".`,
    targets
  );
}
