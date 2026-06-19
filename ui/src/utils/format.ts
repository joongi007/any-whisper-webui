/** "5분 전" / "어제 14:32" / "2026-05-22" — graceful fall-through. */
export function formatRelative(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = now.getTime() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "방금";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  if (hr < 24 * 7) return `${Math.round(hr / 24)}일 전`;
  // Anything older — absolute YYYY-MM-DD.
  return d.toISOString().slice(0, 10);
}

/** "ko" → "한국어", "en" → "English", unknown → as-is. */
const LANG_NAMES: Record<string, string> = {
  auto: "자동", ko: "한국어", en: "English", ja: "日本語", zh: "中文",
  es: "Español", fr: "Français", de: "Deutsch", ru: "Русский",
  ar: "العربية", hi: "हिन्दी", pt: "Português", it: "Italiano",
  vi: "Tiếng Việt", id: "Bahasa", th: "ไทย",
};
export function formatLanguage(code: string | null | undefined): string {
  if (!code) return "—";
  return LANG_NAMES[code] ?? code;
}
