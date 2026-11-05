import type { Metadata } from "next";
import "./globals.css";
import "./appearances.css";

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
          href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Source+Sans+3:wght@400;500;600&family=Inter:wght@400;500;600&family=Noto+Naskh+Arabic:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
