import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "leaflet/dist/leaflet.css";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  applicationName: "Radar Lluvia",
  title: "Radar Meteorológico en Directo",
  description: "Mapa en directo con radar de precipitación y geolocalización",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-icon.png",
  },
  // Metadatos que iOS necesita para instalar la web como app a pantalla
  // completa (Safari ignora buena parte del manifest; usa estas meta).
  appleWebApp: {
    capable: true,
    title: "Radar Lluvia",
    statusBarStyle: "default",
  },
};

// El color de tema tiñe la barra de estado del móvil cuando la app está
// instalada (modo standalone), para que se integre con el azul de la app.
export const viewport: Viewport = {
  themeColor: "#12579f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full flex flex-col">{children}</body>
    </html>
  );
}
