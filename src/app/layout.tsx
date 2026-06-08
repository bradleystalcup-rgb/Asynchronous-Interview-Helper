import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Asynchronous Interview Helper",
  description: "Record local-only interview responses with a teleprompter.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
