import { describe, expect, it } from "vitest";
import { resolveCronSecret } from "../lib/env.mjs";

describe("resolveCronSecret", () => {
  it("memakai CRON_SECRET dari environment", () => {
    expect(resolveCronSecret({ CRON_SECRET: "abc" } as NodeJS.ProcessEnv)).toBe("abc");
  });

  it("menerima INGEST_SECRET_KEY sebagai cadangan", () => {
    expect(resolveCronSecret({ INGEST_SECRET_KEY: "xyz" } as NodeJS.ProcessEnv)).toBe("xyz");
  });

  it("melempar error bila tidak ada secret", () => {
    expect(() => resolveCronSecret({} as NodeJS.ProcessEnv)).toThrow(/CRON_SECRET wajib/);
  });
});
