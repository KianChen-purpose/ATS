import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "PATS", template: "%s · PATS" },
  description: "Purpose Applicant Tracking System",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full">{children}</body>
    </html>
  );
}
