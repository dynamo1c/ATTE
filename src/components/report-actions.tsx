"use client";

import { buttonClass } from "./ui";

/** Print / "Save as PDF" (the print stylesheet hides navigation and buttons). */
export function PrintButton({ label = "Print / PDF" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={`no-print ${buttonClass("secondary", "sm")}`}>
      {label}
    </button>
  );
}

/** Excel download of the report with the same filters as the screen. A plain link: never prefetched. */
export function ExcelLink({ href, label = "Excel" }: { href: string; label?: string }) {
  return (
    <a href={href} download className={`no-print ${buttonClass("secondary", "sm")}`}>
      {label}
    </a>
  );
}

export function ReportActions({ excel, print = true }: { excel?: string; print?: boolean }) {
  return (
    <div className="no-print flex flex-wrap gap-2">
      {excel && <ExcelLink href={excel} />}
      {print && <PrintButton />}
    </div>
  );
}
