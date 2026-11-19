import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processRawPost } from "@/lib/radar/pipeline";
import type { DealCandidate } from "@/lib/radar/valuation";

/**
 * Fake Supabase query builder secukupnya untuk menguji pipeline ingest.
 */
function makeFakeSupabase(
  comparables: DealCandidate[],
  options: { insertFailsWithMissingColumn?: boolean } = {}
) {
  const inserted: Record<string, unknown>[] = [];
  let insertAttempts = 0;

  class Query {
    constructor(
      private table: string,
      private columns: string
    ) {}

    eq() {
      return this;
    }
    not() {
      return this;
    }
    gt() {
      return this;
    }
    gte() {
      return this;
    }
    order() {
      return this;
    }
    limit() {
      return this;
    }

    private result(): { data: unknown; error: null } {
      if (this.table === "cities") {
        return { data: { id: 1, name: "Purwokerto" }, error: null };
      }
      if (this.table === "subscriptions") {
        return { data: [], error: null };
      }
      if (this.table === "listings" && this.columns.trim() === "id") {
        return { data: null, error: null };
      }
      return { data: comparables, error: null };
    }

    single() {
      return Promise.resolve(this.result());
    }

    then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
      onfulfilled?:
        | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve(this.result()).then(onfulfilled, onrejected);
    }
  }

  const supabase = {
    from(table: string) {
      return {
        select(columns: string) {
          return new Query(table, columns);
        },
        insert(row: Record<string, unknown>) {
          insertAttempts += 1;
          if (options.insertFailsWithMissingColumn && insertAttempts === 1) {
            return Promise.resolve({
              error: {
                code: "42703",
                message: 'column "market_value" of relation "listings" does not exist',
              },
            });
          }
          inserted.push(row);
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  return { supabase, inserted };
}

function comparable(overrides: Partial<DealCandidate> = {}): DealCandidate {
  return {
    id: Math.random().toString(36).slice(2),
    title: "Kos Putri Area Kampus Sekitar",
    price_monthly: 1_000_000,
    property_type: "kos_putri",
    area_tag: "Area Kampus Sekitar",
    facilities: ["KM Dalam", "WiFi", "Kasur", "Lemari"],
    posted_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    image_urls: ["https://example.com/1.jpg"],
    source_url: "https://example.com/post",
    contact_wa: "6281234567890",
    ...overrides,
  };
}

describe("processRawPost", () => {
  let previousKey: string | undefined;

  beforeAll(() => {
    previousKey = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "";
  });

  afterAll(() => {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  });

  it("menilai listing dan menyimpan hasil deal engine", async () => {
    const comparables = Array.from({ length: 8 }, (_, index) =>
      comparable({
        id: `comp-${index}`,
        price_monthly: 950_000 + index * 15_000,
      })
    );
    const { supabase, inserted } = makeFakeSupabase(comparables);

    const result = await processRawPost(supabase as never, {
      raw_text:
        "Kos putri Area Kampus Sekitar, 650rb/bulan, KM Dalam, WiFi, kasur, lemari. WA 081234567890",
      city_slug: "purwokerto",
      image_urls: ["https://example.com/room.jpg"],
      source_url: "https://facebook.com/groups/kos/posts/1",
      platform: "telegram",
      source_name: "@infokosmalang",
      posted_at_source: "2026-11-18T10:00:00+00:00",
      caption: "Kos putri Area Kampus Sekitar, 650rb/bulan. WA 081234567890",
    });

    expect(result.status).toBe("inserted");
    expect(inserted).toHaveLength(1);

    const row = inserted[0];
    expect(row.source_platform).toBe("telegram");
    expect(row.source_name).toBe("@infokosmalang");
    expect(row.posted_at_source).toBe("2026-11-18T10:00:00+00:00");
    expect(row.caption).toBe(
      "Kos putri Area Kampus Sekitar, 650rb/bulan. WA 081234567890"
    );
    expect(row.price_monthly).toBe(650_000);
    expect(row.is_undervalued).toBe(true);
    expect(row.market_value).toBeGreaterThan(800_000);
    expect(row.discount_pct).toBeGreaterThan(12);
    expect(row.deal_score).toBeGreaterThan(50);
    expect(row.deal_confidence).toBeGreaterThan(0.45);
    expect(row.deal_grade).toBeDefined();
  });

  it("menyimpan detail heuristik harga dan ukuran kamar", async () => {
    const { supabase, inserted } = makeFakeSupabase(
      Array.from({ length: 8 }, (_, index) =>
        comparable({
          id: `comp-${index}`,
          price_monthly: 950_000 + index * 15_000,
        })
      )
    );

    const result = await processRawPost(supabase as never, {
      raw_text:
        "Kos campur 3x4 m, harga 700rb nego, WiFi, KM dalam, listrik token. WA 081234567890",
      city_slug: "purwokerto",
    });

    expect(result.status).toBe("inserted");
    const row = inserted[0];
    expect(row.room_size_m2).toBe(12);
    expect(row.price_raw).toContain("700");
    expect(row.is_negotiable).toBe(true);
    expect(row.bathroom_type).toBe("dalam");
    expect(row.electricity).toBe("token");
    expect(row.rules).toEqual({});
    expect(row.nearby_landmarks).toEqual([]);
  });

  it("tetap menyimpan listing inti saat kolom valuasi belum dimigrasi", async () => {
    const { supabase, inserted } = makeFakeSupabase(
      Array.from({ length: 8 }, (_, index) =>
        comparable({
          id: `comp-${index}`,
          price_monthly: 980_000 + index * 10_000,
        })
      ),
      { insertFailsWithMissingColumn: true }
    );

    const result = await processRawPost(supabase as never, {
      raw_text:
        "Kos putri Area Kampus Sekitar, 650rb/bulan, KM Dalam, WiFi. WA 081234567890",
      city_slug: "purwokerto",
    });

    expect(result.status).toBe("inserted");
    expect(inserted).toHaveLength(1);
    const row = inserted[0];
    expect(row.is_undervalued).toBe(true);
    expect(row.market_value).toBeUndefined();
    expect(row.deal_score).toBeUndefined();
  });
});
