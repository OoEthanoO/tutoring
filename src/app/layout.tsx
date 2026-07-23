import { Suspense } from "react";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import MigrationBanner from "@/components/MigrationBanner";
import DiscordConnectBanner from "@/components/DiscordConnectBanner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "YanLearn",
  description: "Education for all",
  icons: {
    icon: [
      {
        url: "/logo.svg",
        type: "image/svg+xml",
      },
    ],
  },
};

import { NotificationProvider } from "@/components/Notification";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <NotificationProvider>
          <Suspense fallback={null}>
            <MigrationBanner />
            <DiscordConnectBanner />
          </Suspense>
          {children}
        </NotificationProvider>
      </body>
    </html>
  );
}
