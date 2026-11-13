import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Gilroy: ArcelorMittal brand typeface (Branding/fonts). Regular for text, SemiBold for headings.
const gilroy = localFont({
  variable: "--font-gilroy",
  display: "swap",
  src: [
    { path: "./fonts/Gilroy-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Gilroy-SemiBold.woff2", weight: "600", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: "GEDP 2027",
  description: "Global Employee Development Program — narzędzie celów i rozwoju",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pl" className={`${gilroy.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
