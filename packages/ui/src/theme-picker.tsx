"use client";

import { themes, type ThemeId } from "./theme";

export function ThemePicker({ value, onChange }: { value: ThemeId; onChange: (value: ThemeId) => void }) {
  return <label className="bp-theme-picker">
    <span>界面主题</span>
    <select value={value} onChange={(event) => {
      const selected = event.currentTarget.value;
      if (selected === "cyberpunk" || selected === "eastern") onChange(selected);
    }}>
      {Object.values(themes).map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
    </select>
  </label>;
}
