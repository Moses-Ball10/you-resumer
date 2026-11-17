import type { Metadata } from "next";
import { Amiri, Amiri_Quran, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Arabic fonts for the evidence tab: Amiri Quran draws the Uthmani script and its marks correctly.
const amiriQuran = Amiri_Quran({
  variable: "--font-amiri-quran",
  subsets: ["arabic"],
  weight: "400",
});

const amiri = Amiri({
  variable: "--font-amiri",
  subsets: ["arabic"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "You Resumer",
  description: "Summaries and answers from YouTube videos, grounded in what the video says.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${amiriQuran.variable} ${amiri.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
