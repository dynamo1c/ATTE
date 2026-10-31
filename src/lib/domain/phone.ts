/**
 * Indian mobile numbers, stored as E.164: +91 followed by 10 digits starting 6–9.
 * Accepts what people actually type: "98450 12345", "+91-98450-12345", "098450 12345", "919845012345".
 */
export type PhoneResult = { ok: true; value: string } | { ok: false; error: string };

export function normalizeIndianMobile(input: string): PhoneResult {
  let digits = input.replace(/[\s\-().]/g, "");
  if (digits.startsWith("+")) {
    if (!digits.startsWith("+91")) return { ok: false, error: "Only Indian (+91) mobile numbers are supported" };
    digits = digits.slice(3);
  } else if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  if (!/^\d{10}$/.test(digits)) return { ok: false, error: "Mobile number must have 10 digits" };
  if (!/^[6-9]/.test(digits)) return { ok: false, error: "Mobile number must start with 6, 7, 8 or 9" };
  return { ok: true, value: `+91${digits}` };
}

/** "+919845012345" → "98450 12345" for display. */
export function formatIndianMobile(e164: string): string {
  const d = e164.replace(/^\+91/, "");
  return `${d.slice(0, 5)} ${d.slice(5)}`;
}
