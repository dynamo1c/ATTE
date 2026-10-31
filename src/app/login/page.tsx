import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/server/current";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · MEI Attendance" };

export default async function LoginPage(props: PageProps<"/login">) {
  if (await getCurrentStaff()) redirect("/");
  const { next } = await props.searchParams;
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
      </div>
    </main>
  );
}
