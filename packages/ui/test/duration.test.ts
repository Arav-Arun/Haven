import { describe, expect, it } from "vitest";
import { parseDuration } from "../src/ShareDialog";

describe("typed share durations", () => {
  it("reads the ways people write a length of time", () => {
    expect(parseDuration("5m 30s")).toBe(330);
    expect(parseDuration("5 min 30 sec")).toBe(330);
    expect(parseDuration("5 minutes and 30 seconds")).toBe(330);
    expect(parseDuration("1h30m")).toBe(5400);
    expect(parseDuration("2 hours")).toBe(7200);
    expect(parseDuration("3 days")).toBe(259_200);
    expect(parseDuration("1 week")).toBe(604_800);
    expect(parseDuration("90")).toBe(5400); // a bare number is minutes
    expect(parseDuration("1.5h")).toBe(5400);
  });
  it("refuses what it can't read", () => {
    for (const bad of ["", "soon", "5 fortnights", "m5", "0m", "-5m"]) expect(parseDuration(bad)).toBeNull();
  });
});
