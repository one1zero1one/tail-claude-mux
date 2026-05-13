import { describe, expect, test } from "bun:test";
import type { PaneRow } from "../src/shared";

describe("PaneRow.windowActive", () => {
  test("is a required boolean field", () => {
    const row: PaneRow = {
      paneId: "%1",
      windowId: "@1",
      windowName: "work",
      windowActivityFlag: false,
      windowActive: false,
      paneCurrentCommand: "zsh",
      paneCurrentPath: "/tmp",
    };
    expect(typeof row.windowActive).toBe("boolean");
  });

  test("PaneRow without windowActive is a type error", () => {
    // @ts-expect-error windowActive is required
    const row: PaneRow = {
      paneId: "%1",
      windowId: "@1",
      windowName: "work",
      windowActivityFlag: false,
      paneCurrentCommand: "zsh",
      paneCurrentPath: "/tmp",
    };
    expect(row.paneId).toBe("%1");
  });
});
