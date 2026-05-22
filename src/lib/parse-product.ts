// Parses an order's "product" text field into individual items.
// Format examples:
//   "1 * ترنج مارسيليا جيب [اسود-XXXL]"
//   "1 * Product A [Red-L]|2 * Product B [Blue-M]"
//   "ترنج مارسيليا"  (no quantity, no option)

export type ParsedItem = {
  quantity: number;
  base_product_name: string;
  product_option: string | null;
  color: string | null;
  size: string | null;
  raw_product_text: string;
};

export function parseProductField(raw: unknown): ParsedItem[] {
  const text = String(raw ?? "").trim();
  if (!text) return [];
  const segments = text.split("|").map((s) => s.trim()).filter(Boolean);
  const items: ParsedItem[] = [];
  for (const seg of segments) {
    items.push(parseSingle(seg));
  }
  return items;
}

function parseSingle(seg: string): ParsedItem {
  const raw = seg;
  let quantity = 1;
  let rest = seg;

  // Match leading "<num> *" or "<num>x"
  const qMatch = rest.match(/^\s*(\d+)\s*[*x×]\s*(.*)$/i);
  if (qMatch) {
    quantity = Math.max(1, parseInt(qMatch[1], 10) || 1);
    rest = qMatch[2];
  }

  // Extract bracketed option
  let option: string | null = null;
  const bracket = rest.match(/^(.*?)\[([^\]]*)\]\s*$/);
  let baseName = rest.trim();
  if (bracket) {
    baseName = bracket[1].trim();
    option = bracket[2].trim() || null;
  }

  let color: string | null = null;
  let size: string | null = null;
  if (option && option.includes("-")) {
    const lastDash = option.lastIndexOf("-");
    color = option.slice(0, lastDash).trim() || null;
    size = option.slice(lastDash + 1).trim() || null;
  } else if (option) {
    color = option;
  }

  return {
    quantity,
    base_product_name: baseName || raw,
    product_option: option,
    color,
    size,
    raw_product_text: raw,
  };
}
