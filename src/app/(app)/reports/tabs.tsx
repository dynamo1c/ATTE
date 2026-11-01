import Link from "next/link";

export function ReportTabs({ active, showCompliance }: { active: "attendance" | "compliance"; showCompliance: boolean }) {
  const tabs = [{ key: "attendance", href: "/reports/attendance", label: "Attendance shortage" }, ...(showCompliance ? [{ key: "compliance", href: "/reports/compliance", label: "Not yet entered" }] : [])];
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className={`rounded-md px-3 py-1.5 text-sm ${t.key === active ? "bg-blue-700 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
