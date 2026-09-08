import type { PropsWithChildren } from "react";

export type ThemeId = "cyberpunk" | "eastern";

export const themes = Object.freeze({
  cyberpunk: Object.freeze({ id: "cyberpunk", version: 1, label: "赛博 · 星轨", colorScheme: "dark" }),
  eastern: Object.freeze({ id: "eastern", version: 1, label: "山水 · 行旅", colorScheme: "light" }),
} as const);

/** Accept only bundled, versioned presentation data; never load arbitrary theme URLs. */
export function resolveTheme(preference: unknown) {
  if (typeof preference === "object" && preference !== null && "id" in preference && "version" in preference && preference.version === 1) {
    if (preference.id === "eastern") return themes.eastern;
    if (preference.id === "cyberpunk") return themes.cyberpunk;
  }
  return themes.cyberpunk;
}

export function ThemeSurface({ theme, density = "comfortable", children }: PropsWithChildren<{
  theme: ThemeId;
  density?: "comfortable" | "compact";
}>) {
  return <div className="bp-theme" data-bp-theme={theme} data-bp-density={density}>{children}</div>;
}
