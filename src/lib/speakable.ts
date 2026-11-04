// Rewrites technical text so the Arabic voice pronounces it correctly
// (units, abbreviations, model codes) instead of spelling Latin letters.

const UNITS: [RegExp, string][] = [
  [/(\d+(?:[.,]\d+)?)\s*kWh\b/gi, "$1 كيلو واط ساعة"],
  [/(\d+(?:[.,]\d+)?)\s*kW\b/gi, "$1 كيلو واط"],
  [/(\d+(?:[.,]\d+)?)\s*Ah\b/gi, "$1 أمبير ساعة"],
  [/(\d+(?:[.,]\d+)?)\s*W\b/g, "$1 واط"],
  [/(\d+(?:[.,]\d+)?)\s*V\b/g, "$1 فولت"],
  [/(\d+(?:[.,]\d+)?)\s*A\b/g, "$1 أمبير"],
  [/(\d+(?:[.,]\d+)?)\s*kg\b/gi, "$1 كيلوغرام"],
  [/(\d+(?:[.,]\d+)?)\s*Hz\b/gi, "$1 هيرتز"],
  [/(\d+(?:[.,]\d+)?)\s*%/g, "$1 بالمئة"],
];

const WORDS: [RegExp, string][] = [
  [/\bMPPT\b/gi, "إم بي بي تي"],
  [/\bIP\s?(\d)(\d)\b/gi, "آي بي $1$2"],
  [/\bLiFePO4\b/gi, "ليثيوم حديد فوسفات"],
  [/\bBMS\b/g, "نظام إدارة البطارية"],
  [/\bWi-?Fi\b/gi, "واي فاي"],
  [/\bBluetooth\b/gi, "بلوتوث"],
  [/\bAC\b/g, "إيه سي"],
  [/\bDC\b/g, "دي سي"],
  [/\bSolis\b/gi, "سولِيس"],
  [/\bPylontech\b/gi, "بايلونتِك"],
  [/\bFIDUS\b/gi, "فيدوس"],
  [/\bDeye\b/gi, "داي"],
  [/\bGrowatt\b/gi, "جرووات"],
  [/\bHuawei\b/gi, "هواوي"],
];

export function speakable(text: string): string {
  let t = text
    // drop long model codes in brackets, e.g. (Solis-50K-5G-PLUS)
    .replace(/[(（][^)）]*[A-Za-z][^)）]*\d[^)）]*[)）]/g, " ")
    .replace(/[(（][^)）]*\d[^)）]*[A-Za-z][^)）]*[)）]/g, " ");
  for (const [r, v] of UNITS) t = t.replace(r, v);
  for (const [r, v] of WORDS) t = t.replace(r, v);
  return t.replace(/\s+/g, " ").trim();
}
