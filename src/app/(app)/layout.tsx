import Link from "next/link";
import { ROLE_LABEL, navFor, type Role } from "@/lib/auth/permissions";
import { logoutAction } from "@/server/auth-actions";
import { requireStaff } from "@/server/current";
import { Logo } from "@/components/ui";
import { NavLinks } from "./nav-links";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await requireStaff();
  const nav = navFor(me.actor);
  const roles = [...new Set(me.actor.grants.map((g) => g.role))] as Role[];

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Mobile top bar: <details> works without JavaScript. */}
      <details className="group border-b border-slate-200 bg-white md:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2">
          <span className="flex min-w-0 items-center gap-2">
            <Logo className="h-9" />
            <span className="truncate text-sm font-semibold text-slate-900">Attendance</span>
          </span>
          <span className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700">Menu</span>
        </summary>
        <div className="border-t border-slate-200 px-2 pb-3">
          <NavLinks items={nav} />
          <UserBox name={me.name} roles={roles} />
        </div>
      </details>

      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <Link href="/" className="block px-5 py-5">
          <Logo className="h-12" />
          <p className="mt-2 font-semibold text-slate-900">Attendance &amp; Marks</p>
        </Link>
        <div className="flex-1 px-2">
          <NavLinks items={nav} />
        </div>
        <div className="border-t border-slate-200 p-2">
          <UserBox name={me.name} roles={roles} />
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}

function UserBox({ name, roles }: { name: string; roles: Role[] }) {
  return (
    <div className="px-3 pt-3">
      <p className="truncate text-sm font-medium text-slate-900">{name}</p>
      <p className="truncate text-xs text-slate-500">{roles.map((r) => ROLE_LABEL[r]).join(" · ")}</p>
      <div className="mt-1 flex gap-4 text-sm">
        <Link href="/change-password" className="py-2 text-blue-700 hover:underline">
          Change password
        </Link>
        <form action={logoutAction}>
          <button type="submit" className="py-2 text-slate-600 hover:underline">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
