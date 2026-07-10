import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  metadataBase: new URL("https://avtocena.com"),
  title: "АвтоЦена — авто под ваш бюджет за 30 секунд",
  description: "Узнайте, какой автомобиль можно привезти под ваш бюджет и сколько он будет стоить под ключ в России.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      {
        url: "/favicon-light.svg",
        type: "image/svg+xml",
        media: "(prefers-color-scheme: dark)"
      },
      {
        url: "/favicon-dark.svg",
        type: "image/svg+xml",
        media: "(prefers-color-scheme: light)"
      },
      {
        url: "/favicon.ico",
        sizes: "any"
      }
    ],
    apple: [
      {
        url: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png"
      }
    ]
  },
  openGraph: {
    title: "АвтоЦена",
    description: "Авто под ваш бюджет за 30 секунд",
    url: "https://avtocena.com",
    siteName: "АвтоЦена",
    locale: "ru_RU",
    type: "website"
  }
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#07080d" }
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
