import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Eolax Avatar Studio",
  description: "Estudio de vídeos con avatares de IA para marcas.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
