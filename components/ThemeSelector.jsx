"use client";

import { Moon, Sun } from "lucide-react";

import { useTheme } from "@/components/ThemeProvider";

const themeOptions = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

export default function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const isLight = theme === "light";

  return (
    <div className="inline-flex shrink-0 items-center gap-2.5">
      <span
        className={`hidden whitespace-nowrap text-sm font-medium 2xl:inline ${
          isLight ? "text-[#0f172a]" : "text-[#f8fafc]"
        }`}
      >
        {isLight ? "Light Mode" : "Dark Mode"}
      </span>

      <div
        className={`inline-flex rounded-full p-1 ${isLight ? "bg-[#e5e7eb]" : "bg-[#1e293b]"}`}
        role="group"
        aria-label="Color theme"
      >
        {themeOptions.map((option) => {
          const Icon = option.icon;
          const isSelected = theme === option.value;

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setTheme(option.value)}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0891b2] focus-visible:ring-offset-2 ${
                isSelected
                  ? isLight
                    ? "bg-white text-[#0f172a] shadow-sm focus-visible:ring-offset-[#e5e7eb]"
                    : "bg-[#334155] text-white shadow-sm focus-visible:ring-offset-[#1e293b]"
                  : isLight
                    ? "text-[#6b7280] hover:text-[#111827]"
                    : "text-[#94a3b8] hover:text-white"
              }`}
              aria-label={`Use ${option.label.toLowerCase()} mode`}
              aria-pressed={isSelected}
              title={`${option.label} mode`}
            >
              <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={2} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
