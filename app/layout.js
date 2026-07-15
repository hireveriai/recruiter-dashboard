import "./globals.css";

import Script from "next/script";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { OrgTimezoneProvider } from "@/components/OrgTimezoneProvider";
import SessionInactivityGuard from "@/components/SessionInactivityGuard";
import ModalScrollLock from "@/components/system/ModalScrollLock";
import AmbientLoadingProvider from "@/components/system/loading/AmbientLoadingProvider";

export const metadata = {
  title: "HireVeri Recruiter Workspace",
  description:
    "Recruiter workspace for secure interview orchestration, reviewable candidate evidence, and human-controlled hiring decisions.",
  applicationName: "HireVeri Recruiter",
  icons: {
    icon: "/icon.svg",
    shortcut: "/favicon.ico",
  },
};

const GA_MEASUREMENT_ID = "G-N6GNKTH5LY";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <Script
          async
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_MEASUREMENT_ID}');
          `}
        </Script>
      </head>
      <body className="antialiased">
        <OrgTimezoneProvider>
          <AmbientLoadingProvider>
            <ModalScrollLock />
            <SessionInactivityGuard />
            {children}
            <SpeedInsights />
          </AmbientLoadingProvider>
        </OrgTimezoneProvider>
      </body>
    </html>
  );
}
