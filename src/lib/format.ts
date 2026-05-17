export function fmtCurrency(n: number | null | undefined) {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat("ar-EG", {
    style: "currency",
    currency: "EGP",
    maximumFractionDigits: 0,
  }).format(v);
}

export function fmtNumber(n: number | null | undefined) {
  return new Intl.NumberFormat("ar-EG").format(Number(n ?? 0));
}

export function fmtPercent(n: number | null | undefined) {
  return new Intl.NumberFormat("ar-EG", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(Number(n ?? 0));
}

export function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-EG", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(date);
}

export function parseExcelDate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    // Excel serial date
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return null;
  // Try DD/MM/YYYY first (common Arabic)
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let [, dd, mm, yy] = m;
    if (yy.length === 2) yy = "20" + yy;
    return `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
