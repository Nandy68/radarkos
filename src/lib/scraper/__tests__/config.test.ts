import { describe, expect, it } from "vitest";
import { buildSearchQueries } from "@/lib/scraper/config";

describe("buildSearchQueries", () => {
  it("memuat keyword dan kota untuk X/Twitter", () => {
    const queries = buildSearchQueries("malang", "twitter_x");
    const joined = queries.join(" ");

    expect(queries.length).toBeGreaterThan(0);
    expect(queries.length).toBeLessThanOrEqual(8);
    expect(joined).toContain("kos");
    expect(joined).toContain("Malang");
    expect(joined).toContain("site:x.com");
  });

  it("memakai filter domain untuk Facebook", () => {
    const joined = buildSearchQueries("malang", "facebook").join(" ");

    expect(joined).toContain("site:facebook.com");
  });

  it("mengembalikan array kosong untuk kota tak dikenal", () => {
    expect(buildSearchQueries("atlantis", "twitter_x")).toEqual([]);
  });
});
