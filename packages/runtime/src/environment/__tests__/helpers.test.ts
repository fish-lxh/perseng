/**
 * Tests for runtime environment helpers
 *
 * Covers:
 * - formatClockNote: stable, locale-neutral, with UTC offset
 * - buildSDKContent: clock prefix for string / pure-text / mixed content
 * - buildSDKUserMessage: clock note threaded through to SDK content
 */

import { describe, it, expect } from "bun:test";
import {
  buildSDKContent,
  buildSDKUserMessage,
  formatClockNote,
} from "../helpers";
import type { UserMessage } from "@agentxjs/types/agent";

// Minimal UserMessage factory — only `content` is exercised by the helpers, the
// other fields are required by the type but irrelevant for these tests.
function userMsg(content: UserMessage["content"]): UserMessage {
  return {
    id: "msg_test",
    role: "user",
    subtype: "user",
    timestamp: Date.now(),
    content,
  };
}

describe("formatClockNote", () => {
  it("returns the documented `[System Clock: ...]` shape", () => {
    const note = formatClockNote(new Date(2026, 6, 8, 18, 35, 42));
    // 6 = July (months are 0-indexed)
    expect(note).toBe("[System Clock: 2026-07-08 18:35:42 (UTC" + expectZ(2026, 6, 8, 18, 35, 42) + ")]");
  });

  it("zero-pads single-digit fields", () => {
    const note = formatClockNote(new Date(2026, 0, 3, 4, 5, 6));
    expect(note.startsWith("[System Clock: 2026-01-03 04:05:06 (UTC")).toBe(true);
    expect(note.endsWith(")]")).toBe(true);
  });

  it("defaults to current time when no argument is given", () => {
    const before = Date.now();
    const note = formatClockNote();
    const after = Date.now();

    // Extract the date "2026-07-08 ..." or whatever — but more robustly: assert
    // it contains a plausible year and ends with UTC offset closing bracket.
    expect(note).toMatch(/^\[System Clock: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \(UTC/);
    expect(note.endsWith(")]")).toBe(true);

    // Sanity: parsing the embedded time should land between before and after.
    const match = note.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    expect(match).not.toBeNull();
    const y = match![1]!;
    const mo = match![2]!;
    const d = match![3]!;
    const h = match![4]!;
    const mi = match![5]!;
    const s = match![6]!;
    const ts = new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime();
    expect(ts).toBeGreaterThanOrEqual(before - 1000); // 1s tolerance for tz quirks
    expect(ts).toBeLessThanOrEqual(after + 1000);
  });
});

describe("buildSDKContent — clock injection", () => {
  const note = "[System Clock: 2026-07-08 18:35:42 (UTC+08:00)]";

  it("prepends clock note to plain string content", () => {
    const out = buildSDKContent(userMsg("hello"), note);
    expect(out).toBe(`${note}\n\nhello`);
  });

  it("returns just the clock note when content is missing/empty", () => {
    expect(buildSDKContent(userMsg(undefined as unknown as string), note)).toBe(note);
    expect(buildSDKContent(userMsg(null as unknown as string), note)).toBe(note);
  });

  it("prepends clock note to pure-text part arrays (joined with \\n)", () => {
    const out = buildSDKContent(
      userMsg([{ type: "text", text: "a" }, { type: "text", text: "b" }]),
      note,
    );
    expect(out).toBe(`${note}\n\na\nb`);
  });

  it("prepends clock note as a leading text block for mixed content", () => {
    const out = buildSDKContent(
      userMsg([
        { type: "text", text: "describe this" },
        { type: "image", mediaType: "image/png", data: "BASE64DATA" },
      ]),
      note,
    ) as Array<{ type: string; text?: string; source?: unknown }>;
    expect(Array.isArray(out)).toBe(true);
    // Order: clock header → original text part → image
    expect(out[0]).toEqual({ type: "text", text: note });
    expect(out[1]).toEqual({ type: "text", text: "describe this" });
    expect(out[2]).toMatchObject({ type: "image" });
    expect(out).toHaveLength(3);
  });

  it("omits clock note when not provided (backwards compatible)", () => {
    expect(buildSDKContent(userMsg("hello"))).toBe("hello");
    expect(
      buildSDKContent(userMsg([{ type: "text", text: "a" }])),
    ).toBe("a");
  });
});

describe("buildSDKUserMessage — clock note threaded through", () => {
  it("threads clock note into user content", () => {
    const note = "[System Clock: 2026-07-08 18:35:42 (UTC+08:00)]";
    const sdk = buildSDKUserMessage(userMsg("what time is it?"), "sess-1", note);
    expect(sdk.type).toBe("user");
    expect(sdk.parent_tool_use_id).toBeNull();
    expect(sdk.session_id).toBe("sess-1");
    expect(sdk.message.role).toBe("user");
    expect(sdk.message.content).toBe(`${note}\n\nwhat time is it?`);
  });

  it("does not modify content when clock note is omitted", () => {
    const sdk = buildSDKUserMessage(userMsg("hi"), "sess-2");
    expect(sdk.message.content).toBe("hi");
  });
});

// Helper: figure out the expected UTC offset string for a date constructed in
// the test runner's local timezone. Avoids hard-coding the host TZ.
function expectZ(y: number, m: number, d: number, hh: number, mm: number, ss: number): string {
  const date = new Date(y, m, d, hh, mm, ss);
  const offsetMin = date.getTimezoneOffset();
  if (offsetMin === 0) return "Z";
  const sign = offsetMin > 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, "0");
  const om = String(abs % 60).padStart(2, "0");
  return `${sign}${oh}:${om}`;
}