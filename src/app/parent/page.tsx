import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card } from "@/components/ui";
import { parentOptedOut, requireParent } from "@/server/parent-session";
import { MessageSettings } from "./message-settings";

export default async function ParentHome() {
  const me = await requireParent();
  // Message links point here; one child → straight to their page.
  if (me.children.length === 1) redirect(`/parent/${me.children[0].id}`);
  const optedOut = await parentOptedOut(me.phone);

  return (
    <>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Your children · ನಿಮ್ಮ ಮಕ್ಕಳು</h1>
      {me.children.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-700">This number is no longer linked to any student. If this is a mistake, contact the class teacher.</p>
        </Card>
      ) : (
        <ul className="mb-6 grid gap-3 sm:grid-cols-2">
          {me.children.map((c) => (
            <li key={c.id}>
              <Link href={`/parent/${c.id}`} className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-300">
                <p className="font-medium text-slate-900">{c.name}</p>
                <p className="text-sm text-slate-500">
                  <span className="font-mono">{c.regNo}</span> · {c.className ?? "Not in a class this term"}
                </p>
                {c.status !== "ACTIVE" && <Badge tone="amber">{c.status.toLowerCase()}</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {me.children.length > 0 && <MessageSettings optedOut={optedOut} />}
    </>
  );
}
