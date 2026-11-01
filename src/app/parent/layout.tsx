import Link from "next/link";
import { formatIndianMobile } from "@/lib/domain/phone";
import { parentLogoutAction } from "@/server/parent-actions";
import { getCurrentParent } from "@/server/parent-session";

export const metadata = { title: "Parent portal · MEI Polytechnic" };

export default async function ParentLayout({ children }: LayoutProps<"/parent">) {
  const me = await getCurrentParent();
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/parent" className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-blue-700">MEI Polytechnic</p>
            <p className="truncate font-semibold text-slate-900">
              Parent portal <span className="text-sm font-normal text-slate-500">· ಪೋಷಕರ ಪೋರ್ಟಲ್</span>
            </p>
          </Link>
          {me && (
            <div className="flex shrink-0 items-center gap-3 text-xs">
              <span className="hidden text-slate-500 sm:inline">{formatIndianMobile(me.phone)}</span>
              <form action={parentLogoutAction}>
                <button type="submit" className="rounded-md border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-50">
                  Sign out
                </button>
              </form>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
    </div>
  );
}
