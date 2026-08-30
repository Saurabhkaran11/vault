/* User-selectable accent colour. The app's primary accent is the --moss /
 * --moss-soft pair (historical name; the default palette is blue). Each preset
 * carries a light and a dark pair so the accent stays legible in both themes,
 * matching how globals.css hand-tunes its dark tints. applyAccent writes the
 * chosen pair as inline custom properties on <html>, overriding the stylesheet
 * defaults. The choice lives in the user's profile (localStorage). */

export const ACCENTS = [
  { id: "blue",    name: "Blue",    light: { a: "#1F5FA8", s: "#DFEAF7" }, dark: { a: "#82B4E8", s: "#1D3350" } },
  { id: "teal",    name: "Teal",    light: { a: "#0E7C74", s: "#D8F0EC" }, dark: { a: "#4FC3B7", s: "#123433" } },
  { id: "violet",  name: "Violet",  light: { a: "#5B4BC4", s: "#E7E3FA" }, dark: { a: "#A99BF0", s: "#262251" } },
  { id: "emerald", name: "Emerald", light: { a: "#1E7D50", s: "#DCF0E4" }, dark: { a: "#5FC08A", s: "#173120" } },
  { id: "amber",   name: "Amber",   light: { a: "#A9782E", s: "#F3E8CF" }, dark: { a: "#D8AE63", s: "#302713" } },
  { id: "rose",    name: "Rose",    light: { a: "#C04668", s: "#F8E3EA" }, dark: { a: "#E890A8", s: "#3A2029" } },
  { id: "slate",   name: "Slate",   light: { a: "#4A5568", s: "#E7E9EE" }, dark: { a: "#93A0B5", s: "#26303F" } },
];

export const DEFAULT_ACCENT = "blue";

/* Write the chosen accent's pair for the current theme onto <html>. */
export function applyAccent(id, theme) {
  if (typeof document === "undefined") return;
  const acc = ACCENTS.find((x) => x.id === id) || ACCENTS[0];
  const pair = theme === "dark" ? acc.dark : acc.light;
  const root = document.documentElement.style;
  root.setProperty("--moss", pair.a);
  root.setProperty("--moss-soft", pair.s);
}

/* ---- background tint + chart colour (Settings → Preferences) ----
 * Backgrounds are near-white so ink contrast never suffers; chart colours
 * are all ≥4.5:1 on white panels, so every chart stays clearly readable. */
export const BG_TINTS = [
  { id: "mist",     name: "Mist",     bg: "#EFF3F8" },   // default
  { id: "paper",    name: "Paper",    bg: "#F7F3EB" },
  { id: "sage",     name: "Sage",     bg: "#EEF4EF" },
  { id: "lavender", name: "Lavender", bg: "#F2F1F9" },
  { id: "cloud",    name: "Cloud",    bg: "#F4F5F7" },
];
export const DEFAULT_BG = "mist";

export const CHART_COLORS = [
  { id: "accent",  name: "Match accent", hex: null },    // follows the accent pair
  { id: "blue",    name: "Blue",    hex: "#1F5FA8" },
  { id: "teal",    name: "Teal",    hex: "#0C6E8C" },
  { id: "violet",  name: "Violet",  hex: "#5B4BC4" },
  { id: "green",   name: "Green",   hex: "#1F7A4D" },
  { id: "crimson", name: "Crimson", hex: "#B23A2E" },
];
export const DEFAULT_CHART = "accent";

export function applyThemeExtras(bgId, chartId, accentId, theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement.style;
  const tint = BG_TINTS.find((t) => t.id === bgId) || BG_TINTS[0];
  if (theme !== "dark") root.setProperty("--bg", tint.bg);
  else root.removeProperty("--bg");
  const cc = CHART_COLORS.find((c) => c.id === chartId) || CHART_COLORS[0];
  const acc = ACCENTS.find((x) => x.id === accentId) || ACCENTS[0];
  root.setProperty("--chart", cc.hex || (theme === "dark" ? acc.dark.a : acc.light.a));
}
