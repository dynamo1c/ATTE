import Link from "next/link";
import { redirect } from "next/navigation";
import { DemoFill } from "@/components/demo-fill";
import { getCurrentStaff } from "@/server/current";
import { demoStaffLogins } from "@/server/demo";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · MEI Attendance" };

export default async function LoginPage(props: PageProps<"/login">) {
  if (await getCurrentStaff()) redirect("/");
  const { next } = await props.searchParams;
  const demo = await demoStaffLogins();
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-700">MEI Polytechnic</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Staff sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Attendance · Marks · Parent updates</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <LoginForm next={typeof next === "string" ? next : ""} />
        </div>
        <p className="mt-4 text-center text-xs text-slate-500">Forgot your password? Ask the college admin to reset it.</p>
        {demo && (
          <DemoFill
            title="Demo logins (dummy data)"
            note={`Tap a role to fill the form. Password for all: ${demo.password}`}
            rows={demo.logins.map((l) => ({ label: l.role, detail: `${l.name} · ${l.phone}`, values: { phone: l.phone, password: demo.password } }))}
          />
        )}
        <p className="mt-4 text-center text-xs text-slate-500">
          Parent? <Link href="/parent/login" className="text-blue-700 hover:underline">Parent sign in</Link>
        </p>
      </div>
    </main>
  );
}
