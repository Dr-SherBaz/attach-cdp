import test from "node:test";
import assert from "node:assert/strict";

import { matchTarget, describeTargets, TargetNotFoundError } from "../src/match.js";

const targets = [
  {
    targetId: "AAA",
    title: "My courses | AAGHI_LMS",
    url: "https://lms3.aiou.edu.pk/my/courses.php",
  },
  {
    targetId: "BBB",
    title: "WORKSHOP|8613|G1645 - Grading | AAGHI_LMS",
    url: "https://lms3.aiou.edu.pk/mod/assign/view.php?id=5085063&action=grading",
  },
  {
    targetId: "CCC",
    title: "Search results",
    url: "https://www.google.com/search?q=cdp",
  },
];

test("matches an exact target id", () => {
  assert.equal(matchTarget(targets, "BBB").targetId, "BBB");
});

test("matches a zero-based index", () => {
  assert.equal(matchTarget(targets, "#0").targetId, "AAA");
  assert.equal(matchTarget(targets, "#2").targetId, "CCC");
});

test("matches a URL substring case-insensitively", () => {
  assert.equal(matchTarget(targets, "MOD/ASSIGN").targetId, "BBB");
});

test("matches a title substring when the URL does not match", () => {
  assert.equal(matchTarget(targets, "grading").targetId, "BBB");
});

test("prefers URL matches over title matches", () => {
  const list = [
    { targetId: "T", title: "example.com notes", url: "https://other.test/" },
    { targetId: "U", title: "Other", url: "https://example.com/page" },
  ];
  assert.equal(matchTarget(list, "example.com").targetId, "U");
});

test("returns the first match in browser order", () => {
  const list = [
    { targetId: "1", title: "a", url: "https://x.test/one" },
    { targetId: "2", title: "b", url: "https://x.test/two" },
  ];
  assert.equal(matchTarget(list, "x.test").targetId, "1");
});

test("throws a helpful error listing candidates", () => {
  assert.throws(
    () => matchTarget(targets, "nope"),
    (error) => {
      assert.ok(error instanceof TargetNotFoundError);
      assert.match(error.message, /No open tab matches/);
      assert.equal(error.candidates.length, 3);
      return true;
    }
  );
});

test("throws when the index is out of range", () => {
  assert.throws(() => matchTarget(targets, "#9"), /No tab at index #9/);
});

test("throws on an empty selector and an empty browser", () => {
  assert.throws(() => matchTarget(targets, ""), /selector is required/);
  assert.throws(() => matchTarget([], "anything"), /no page targets/);
});

test("describeTargets renders indexes and urls", () => {
  const rendered = describeTargets(targets);
  assert.match(rendered, /#0 {2}My courses/);
  assert.match(rendered, /lms3\.aiou\.edu\.pk\/my\/courses\.php/);
});
