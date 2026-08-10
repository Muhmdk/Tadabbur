import type { Metadata } from "next";
import "./globals.css";

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
      <body className="antialiased">{children}</body>
    </html>
  );
}
