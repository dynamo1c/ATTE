import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-slate-900">Page not found</h1>
      <p className="mt-2 text-sm text-slate-600">This page doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <div className="mt-6 flex justify-center gap-3 text-sm">
        <Link href="/" className="text-blue-700 hover:underline">
          Staff home
        </Link>
        <Link href="/parent" className="text-blue-700 hover:underline">
          Parent portal
        </Link>
      </div>
    </main>
  );
}
