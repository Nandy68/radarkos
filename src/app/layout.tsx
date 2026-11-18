import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-plus-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "KosRadar — Radar Kos & Oper Kontrak Real-Time",
  description:
    "Pantau kamar kos kosong, oper kontrak murah, dan diskon tersembunyi langsung dari sumber publik sebelum diserobot orang lain.",
  openGraph: {
    title: "KosRadar — Radar Kos & Oper Kontrak Real-Time",
    description:
      "Akses kontak langsung pemilik kos & oper kontrak cepat. Hanya Rp10.000 untuk 14 hari.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#059669",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isProduction = process.env.MIDTRANS_IS_PRODUCTION === "true";
  const snapScriptUrl = isProduction
    ? "https://app.midtrans.com/snap/snap.js"
    : "https://app.sandbox.midtrans.com/snap/snap.js";
  const clientKey = process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY || "";

  return (
    <html lang="id" className={`light ${plusJakartaSans.variable}`}>
      <head>
        <Script
          src={snapScriptUrl}
          data-client-key={clientKey}
          strategy="afterInteractive"
        />
      </head>
      <body className="bg-slate-50 text-slate-900 antialiased flex flex-col min-h-screen font-sans selection:bg-emerald-100 selection:text-emerald-900">
        {children}
      </body>
    </html>
  );
}
