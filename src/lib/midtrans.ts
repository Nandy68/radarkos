import midtransClient from "midtrans-client";
import {
  MIDTRANS_IS_PRODUCTION,
  MIDTRANS_SERVER_KEY,
  MIDTRANS_CLIENT_KEY,
} from "./constants";

/** Midtrans Snap client (server-side). */
export const snap = new midtransClient.Snap({
  isProduction: MIDTRANS_IS_PRODUCTION,
  serverKey: MIDTRANS_SERVER_KEY,
  clientKey: MIDTRANS_CLIENT_KEY,
});

/** Midtrans Core API client (untuk verifikasi notifikasi). */
export const coreApi = new midtransClient.CoreApi({
  isProduction: MIDTRANS_IS_PRODUCTION,
  serverKey: MIDTRANS_SERVER_KEY,
  clientKey: MIDTRANS_CLIENT_KEY,
});

