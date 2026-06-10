import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Eolax Avatar Studio",
  description: "AI talking-head video studio for brand-exclusive avatars.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
