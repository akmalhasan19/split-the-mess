import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Split The Mess — Patungan Tanpa Drama",
  description:
    "Foto struk, share link, centang makananmu. Pajak & diskon dibagi proporsional otomatis.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" className="h-full antialiased">
      <body className="bg-zinc-50 text-zinc-950 antialiased">
        <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
          {children}
        </div>
      </body>
    </html>
  );
}
