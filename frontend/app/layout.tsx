import type { Metadata } from "next";
import "./globals.css";

/*
 * Fonts are loaded via <link> (as in the source mockup) rather than next/font,
 * so the build never blocks on a font fetch and the exact Google faces resolve
 * at runtime: Inter for the Latin UI, Noto Naskh Arabic for every RTL block.
 * The CSS variables --font-inter / --font-arabic (see globals.css) name these
 * faces first, with system fallbacks.
 */
export const metadata: Metadata = {
  title: "Tadabbur | Live khutbah translation",
  description: "A clear, respectful live translation experience for Friday sermons.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Naskh+Arabic:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
