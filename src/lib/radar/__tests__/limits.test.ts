import { describe, expect, it } from "vitest";
import { getAiLimits } from "@/lib/radar/limits";

describe("getAiLimits", () => {
  it("memakai default sesuai spesifikasi", () => {
    expect(getAiLimits({} as unknown as NodeJS.ProcessEnv)).toEqual({
      maxCharsPerPost: 700,
      maxPostsPerRun: 40,
      maxCallsPerRun: 8,
      batchSize: 8,
    });
  });

  it("membaca override dari environment", () => {
    const limits = getAiLimits({
      AI_MAX_CHARS_PER_POST: "500",
      AI_MAX_POSTS_PER_RUN: "10",
      AI_MAX_CALLS_PER_RUN: "2",
    } as unknown as NodeJS.ProcessEnv);

    expect(limits.maxCharsPerPost).toBe(500);
    expect(limits.maxPostsPerRun).toBe(10);
    expect(limits.maxCallsPerRun).toBe(2);
  });

  it("mengabaikan nilai tidak valid", () => {
    const limits = getAiLimits({
      AI_MAX_CHARS_PER_POST: "abc",
      AI_MAX_POSTS_PER_RUN: "-5",
    } as unknown as NodeJS.ProcessEnv);

    expect(limits.maxCharsPerPost).toBe(700);
    expect(limits.maxPostsPerRun).toBe(40);
  });
});
