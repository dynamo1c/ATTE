import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { parentOtp } from "@/db/schema";
import { CODE_TTL_MINUTES, maskPhone, MAX_CODE_TRIES, sha256 } from "@/lib/auth/otp";
import { startOverAction } from "@/server/parent-actions";
import { CHALLENGE_COOKIE, DEMO_COOKIE, getCurrentParent } from "@/server/parent-session";
import { RequestCodeForm, VerifyCodeForm } from "./forms";

export const metadata = { title: "Parent sign in · MEI Polytechnic" };

export default async function ParentLoginPage() {
  if (await getCurrentParent()) redirect("/parent");
  const jar = await cookies();
  const challenge = jar.get(CHALLENGE_COOKIE)?.value;
  // A live challenge → step 2. The row only tells us the phone to show (masked), never whether it matched.
  const [pending] = challenge
    ? await getDb()
        .select({ phone: parentOtp.phone })
        .from(parentOtp)
        .where(and(eq(parentOtp.challengeHash, sha256(challenge)), isNull(parentOtp.usedAt), gt(parentOtp.expiresAt, new Date()), lt(parentOtp.tries, MAX_CODE_TRIES)))
        .limit(1)
    : [];
  const demoCode = pending ? jar.get(DEMO_COOKIE)?.value : undefined;

  return (
    <div className="mx-auto max-w-sm">
      <div className="mb-5 text-center">
        <h1 className="text-2xl font-semibold text-slate-900">Parent sign in</h1>
        <p className="mt-1 text-sm text-slate-500">See your child&apos;s attendance and marks · ಹಾಜರಾತಿ ಮತ್ತು ಅಂಕಗಳು</p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        {pending ? (
          <>
            <p className="mb-4 text-sm text-slate-700">
              If the register number and mobile number match our records, a code has been sent on WhatsApp (or SMS) to <span className="font-medium">{maskPhone(pending.phone)}</span>. It is valid for {CODE_TTL_MINUTES} minutes.
            </p>
            {demoCode && (
              <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Demo mode, nothing is really sent. Your code: <code className="select-all font-mono text-base font-semibold">{demoCode}</code>
              </p>
            )}
            <VerifyCodeForm />
            <form action={startOverAction} className="mt-4 text-center">
              <button type="submit" className="text-sm text-blue-700 hover:underline">
                No code? Check the details and try again
              </button>
            </form>
          </>
        ) : (
          <RequestCodeForm />
        )}
      </div>
      <p className="mt-4 text-center text-xs text-slate-500">
        Only numbers registered with the college can sign in. To add or change your number, contact the class teacher.
      </p>
      <p className="mt-2 text-center text-xs text-slate-500">
        College staff? <a href="/login" className="text-blue-700 hover:underline">Staff sign in</a>
      </p>
    </div>
  );
}
