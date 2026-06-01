import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Poke Voice",
  description: "A real-time voice interface for Poke built with Next.js and the Web Speech API."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
