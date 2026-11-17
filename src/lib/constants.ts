/** Harga langganan per kota selama 14 hari (Rupiah). */
export const SUBSCRIPTION_PRICE = 10_000;

/** Durasi akses setelah pembayaran. */
export const SUBSCRIPTION_DAYS = 14;

/** Jumlah listing preview gratis untuk non-subscriber. */
export const FREE_LISTING_LIMIT = 3;

/** Jumlah device aktif maksimum per subscription. */
export const MAX_DEVICES = 2;

/** Cookie name untuk session akses aktif (HTTP-only). */
export const ACCESS_TOKEN_COOKIE = "kosradar_session";

/** Cookie name untuk claim nonce (pending checkout). */
export const CLAIM_NONCE_COOKIE = "kr_nonce";

/** Midtrans configuration. */
export const MIDTRANS_IS_PRODUCTION = process.env.MIDTRANS_IS_PRODUCTION === "true";
export const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY || "";
export const MIDTRANS_CLIENT_KEY = process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY || process.env.MIDTRANS_CLIENT_KEY || "";
