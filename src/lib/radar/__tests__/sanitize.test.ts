import { describe, expect, it } from "vitest";
import { CONTACT_LOCKED, sanitizeFreeText } from "@/lib/radar/sanitize";

describe("sanitizeFreeText", () => {
  it("menyensor nomor telepon dengan pemisah", () => {
    expect(sanitizeFreeText("Hubungi 0812-3456-7890 ya")).toBe(
      "Hubungi [kontak terkunci] ya"
    );
  });

  it("menyensor link wa.me", () => {
    expect(sanitizeFreeText("Chat wa.me/6281234567890")).toBe(
      "Chat [kontak terkunci]"
    );
    expect(CONTACT_LOCKED).toBe("[kontak terkunci]");
  });

  it("menyensor nomor berawalan +62 dengan spasi", () => {
    expect(sanitizeFreeText("+62 812 3456 7890")).toBe("[kontak terkunci]");
  });

  it("menyensor link t.me berisi nomor telepon", () => {
    expect(sanitizeFreeText("t.me/+6281234567890")).toBe("[kontak terkunci]");
  });

  it("tidak mengubah teks tanpa kontak", () => {
    expect(sanitizeFreeText("Kos dekat UB, 800rb")).toBe("Kos dekat UB, 800rb");
  });

  it("mengembalikan null untuk nilai kosong", () => {
    expect(sanitizeFreeText(null)).toBeNull();
    expect(sanitizeFreeText(undefined)).toBeNull();
  });
});
