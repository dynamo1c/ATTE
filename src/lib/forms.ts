/**
 * Zod helpers for HTML form fields. Browsers send every field as a string ("" when empty),
 * so these convert to the right types and treat "" as "not given".
 */
import { z } from "zod";
import { normalizeIndianMobile } from "./domain/phone";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const text = (label: string, max = 200) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max, `${label} is too long`);

export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, "Too long")
    .optional()
    .transform((v) => (v ? v : null));

export const int = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .regex(/^-?\d+$/, `${label} must be a whole number`)
    .transform(Number);

export const optionalInt = () =>
  z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^-?\d+$/.test(v), "Must be a whole number")
    .transform((v) => (v ? Number(v) : null));

export const decimal = (label: string, min: number, max: number) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, `${label} must be a number`)
    .transform(Number)
    .refine((n) => n >= min && n <= max, `${label} must be between ${min} and ${max}`);

export const date = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .regex(ISO_DATE, `${label} is required`)
    .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()), `${label} is not a valid date`);

export const checkbox = () =>
  z
    .string()
    .optional()
    .transform((v) => v === "on" || v === "true");

export const phone = (label = "Phone") =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .transform((v, ctx) => {
      const r = normalizeIndianMobile(v);
      if (!r.ok) {
        ctx.addIssue({ code: "custom", message: r.error });
        return z.NEVER;
      }
      return r.value;
    });

export const oneOf = <const T extends readonly [string, ...string[]]>(values: T, label: string) =>
  z.enum(values, { error: `Choose a ${label.toLowerCase()}` });

/** FormData → plain object. Repeated keys become arrays. Next.js internal fields are dropped. */
export function formDataToObject(fd: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of fd.entries()) {
    if (key.startsWith("$ACTION")) continue;
    if (typeof value !== "string") continue;
    const prev = out[key];
    out[key] = prev === undefined ? value : Array.isArray(prev) ? [...prev, value] : [prev, value];
  }
  return out;
}
