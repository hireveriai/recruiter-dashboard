import "./globals.css";

import Script from "next/script";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { OrgTimezoneProvider } from "@/components/OrgTimezoneProvider";
import SessionInactivityGuard from "@/components/SessionInactivityGuard";
import { ThemeProvider } from "@/components/ThemeProvider";
import ModalScrollLock from "@/components/system/ModalScrollLock";
import AmbientLoadingProvider from "@/components/system/loading/AmbientLoadingProvider";

export const metadata = {
  title: "HireVeri Recruiter Workspace",
  description:
    "Recruiter workspace for secure interview orchestration, reviewable candidate evidence, and human-controlled hiring decisions.",
  applicationName: "HireVeri Recruiter",
};

const GA_MEASUREMENT_ID = "G-N6GNKTH5LY";
const THEME_INITIALIZER = `
  (() => {
    try {
      const storedTheme = localStorage.getItem("hireveri-theme");
      const preference = ["dark", "light", "system"].includes(storedTheme)
        ? storedTheme
        : "dark";
      const resolvedTheme = preference === "system"
        ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : preference;
      const root = document.documentElement;

      root.dataset.themePreference = preference;
      root.dataset.theme = resolvedTheme;
      root.classList.toggle("dark", resolvedTheme === "dark");
      root.style.colorScheme = resolvedTheme;
    } catch {
      document.documentElement.dataset.themePreference = "dark";
      document.documentElement.dataset.theme = "dark";
      document.documentElement.classList.add("dark");
      document.documentElement.style.colorScheme = "dark";
    }
  })();
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark" data-theme="dark" data-theme-preference="dark" suppressHydrationWarning>
      <head>
        <Script id="hireveri-theme" strategy="beforeInteractive">
          {THEME_INITIALIZER}
        </Script>
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
        <ThemeProvider>
          <OrgTimezoneProvider>
            <AmbientLoadingProvider>
              <ModalScrollLock />
              <SessionInactivityGuard />
              {children}
              <SpeedInsights />
            </AmbientLoadingProvider>
          </OrgTimezoneProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
