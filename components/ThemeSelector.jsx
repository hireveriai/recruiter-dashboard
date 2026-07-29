"use client";

import { Laptop, Moon, Sun } from "lucide-react";

import { useTheme } from "@/components/ThemeProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const themes = [
  {
    value: "dark",
    label: "Dark",
    description: "Use HireVeri's dark appearance",
    icon: Moon,
  },
  {
    value: "light",
    label: "Light",
    description: "Use a brighter workspace",
    icon: Sun,
  },
  {
    value: "system",
    label: "System",
    description: "Match this device's appearance",
    icon: Laptop,
  },
];

export default function ThemeSelector() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const selectedTheme = themes.find((option) => option.value === theme) ?? themes[0];
  const SelectedIcon = selectedTheme.icon;
  const tooltip =
    theme === "system"
      ? `Theme: System (${resolvedTheme})`
      : `Theme: ${selectedTheme.label}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-200 shadow-sm transition-all duration-200 hover:border-slate-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          aria-label={tooltip}
          title={tooltip}
        >
          <SelectedIcon aria-hidden="true" className="h-[19px] w-[19px]" strokeWidth={1.9} />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={12}
        className="w-[250px] rounded-2xl border border-slate-800 bg-slate-950/98 p-2 text-white shadow-[0_20px_60px_rgba(2,6,23,0.38)]"
      >
        <DropdownMenuLabel className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
          Appearance
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-slate-800" />
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          {themes.map((option) => {
            const Icon = option.icon;

            return (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                className="my-1 cursor-pointer gap-3 rounded-xl px-3 py-2.5 pr-9 text-slate-200 outline-none transition-colors focus:bg-slate-800/70 focus:text-white"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-300">
                  <Icon aria-hidden="true" className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{option.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-slate-400">
                    {option.description}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

