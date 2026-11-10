// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "styles.css"), "utf8");

/** The declaration block for one selector. */
function block(selector: string): string {
  const start = css.indexOf(selector);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

describe("inspector stays inside the window", () => {
  it("lets the inspector column shrink instead of growing with a wide note roll or model", () => {
    expect(block(".inspector {")).toContain("min-width: 0");
    expect(block(".body {")).toContain("min-width: 0");
    expect(block(".note-roll {")).toContain("min-width: 0");
    expect(block(".note-roll canvas")).toContain("max-width: 100%");
    expect(block(".model {")).toContain("min-width: 0");
    expect(block(".viewport {")).toContain("min-width: 0");
    expect(block(".viewport canvas")).toContain("max-width: 100%");
    expect(block(".canvas-wrap {")).toContain("min-width: 0");
  });
});
