import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { DemoBanner } from "@/components/demo-banner";

export const metadata: Metadata = {
  title: { default: "PATS", template: "%s · PATS" },
  description: "Purpose Applicant Tracking System",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full">
        {children}
        <DemoBanner />
      </body>
    </html>
  );
}
