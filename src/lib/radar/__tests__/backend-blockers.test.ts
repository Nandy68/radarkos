import { describe, it, expect } from "vitest";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { sendWhatsAppMessage } from "@/lib/radar/notifier";
import { sha256, generateToken } from "@/lib/hash";

describe("Backend Blockers Verification", () => {
  it("Blocker 1: isSupabaseConfigured should detect placeholder vs real configuration", () => {
    const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Test placeholder detection
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://placeholder.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "placeholder-service-key";
    expect(isSupabaseConfigured()).toBe(false);

    // Test real credentials
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://xyzcompany.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy";
    expect(isSupabaseConfigured()).toBe(true);

    // Restore
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  });

  it("Blocker 3: sendWhatsAppMessage should not falsely claim success when WA_GATEWAY_URL is empty", async () => {
    delete process.env.WA_GATEWAY_URL;
    const targetWA = "628987654321";
    const msg = "Radar Alert Test";

    const result = await sendWhatsAppMessage(targetWA, msg);
    expect(result.success).toBe(false);
    expect(result.simulated).toBe(true);
    expect(result.error).toBe("WA_GATEWAY_NOT_CONFIGURED");
    expect(result.wa_link).toBe(`https://wa.me/628987654321?text=${encodeURIComponent(msg)}`);
  });

  it("Blocker 6: Order ID randomness and nonce hashing validation", async () => {
    const token1 = generateToken(16);
    const token2 = generateToken(16);
    expect(token1).not.toBe(token2);
    expect(token1.length).toBe(32); // 16 bytes in hex = 32 chars

    // Nonce verification test
    const claimNonce = generateToken(16);
    const claimNonceHash = await sha256(claimNonce);

    const validAttemptHash = await sha256(claimNonce);
    expect(validAttemptHash).toBe(claimNonceHash);

    const forgedNonce = generateToken(16);
    const forgedAttemptHash = await sha256(forgedNonce);
    expect(forgedAttemptHash).not.toBe(claimNonceHash);
  });
});
