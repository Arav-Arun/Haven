import { DriveError } from "@haven/types";
import { describe, expect, it } from "vitest";
import { describeError } from "../src/errors";
import { formatBytes, formatUntil, ticketSerial } from "../src/format";

describe("format", () => {
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1 MB");
    expect(formatBytes(32 * 1024 * 1024)).toBe("32 MB");
  });

  it("describes when access ends, either way", () => {
    expect(formatUntil(null, 1000)).toBe("No end date");
    expect(formatUntil(1000 + 90, 1000)).toBe("Ends in 1 min");
    expect(formatUntil(1000 + 3 * 3600 + 12 * 60, 1000)).toBe("Ends in 3 h 12 min");
    expect(formatUntil(1000 - 120, 1000)).toBe("Ended 2 min ago");
    expect(formatUntil(1000, 1000)).toBe("Ended 0 s ago");
  });

  it("takes the ticket serial from the address the chain shows", () => {
    expect(ticketSerial("0x4f2a9cdeadbeef")).toBe("4F2A9C");
  });
});

describe("describeError", () => {
  it("maps DriveError codes to fixed wording", () => {
    expect(describeError(new DriveError("REFRESH_PENDING")).title).toBe("Waiting for the owner to refresh access");
    expect(describeError(new DriveError("NO_HAVEN_KEY")).title).toBe("This name hasn't set up Haven yet");
    expect(describeError(new DriveError("KEY_MISMATCH")).detail).toMatch(/Your files are safe/);
  });

  it("treats wallet rejections as a cancel, and keeps other messages", () => {
    expect(describeError(Object.assign(new Error("User rejected the request."), { code: 4001 })).title).toBe("Cancelled in your wallet");
    expect(describeError(new Error("boom")).detail).toBe("boom");
  });
});
