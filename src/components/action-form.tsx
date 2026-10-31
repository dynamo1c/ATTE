"use client";

/**
 * Form wrapper for Server Actions.
 * - Submits via a transition instead of a form action, so React does NOT clear what the user typed
 *   when validation fails.
 * - Shows the form error / success message and per-field errors (via <Field>).
 * - Optional `confirm` prompt for destructive actions.
 */
import Link from "next/link";
import { createContext, startTransition, use, useActionState, useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import type { ActionState } from "@/lib/action-state";
import { buttonClass } from "./ui";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const FormCtx = createContext<{ pending: boolean; state: ActionState }>({ pending: false, state: null });

export function ActionForm({
  action,
  children,
  className,
  confirm,
  resetOnSuccess = false,
  hideMessages = false,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  confirm?: string;
  resetOnSuccess?: boolean;
  hideMessages?: boolean;
}) {
  const [state, dispatch, pending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok && resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <FormCtx value={{ pending, state }}>
      <form
        ref={formRef}
        className={className}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) return;
          if (confirm && !window.confirm(confirm)) return;
          const fd = new FormData(e.currentTarget);
          startTransition(() => dispatch(fd));
        }}
      >
        {children}
        {!hideMessages && <FormMessage />}
      </form>
    </FormCtx>
  );
}

export function FormMessage() {
  const { state } = use(FormCtx);
  if (!state) return null;
  return (
    <div aria-live="polite" className="mt-3 space-y-2">
      {state.error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>}
      {state.ok && state.message && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{state.message}</p>}
      {state.ok && state.reveal && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {state.reveal.label}: <code className="select-all rounded bg-white px-1.5 py-0.5 font-mono text-base">{state.reveal.value}</code>
          <p className="mt-1 text-xs">Shown only once. Give it to the person; they must change it at first login.</p>
        </div>
      )}
      {state.ok && state.link && (
        <Link href={state.link.href} className="inline-block text-sm font-medium text-blue-700 hover:underline">
          {state.link.label}
        </Link>
      )}
    </div>
  );
}

/** Label + control + its validation error. */
export function Field({
  label,
  name,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string;
  /** Form field name (for error lookup). Also the input id unless `htmlFor` is given. */
  name: string;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { state } = use(FormCtx);
  const errors = state?.fieldErrors?.[name];
  return (
    <div className={className}>
      <label htmlFor={htmlFor ?? name} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {errors?.length ? (
        <p className="mt-1 text-xs text-red-700">{errors[0]}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function SubmitButton({ children, variant = "primary", size, className, ...props }: ComponentProps<"button"> & { variant?: Parameters<typeof buttonClass>[0]; size?: "sm" | "md" }) {
  const { pending } = use(FormCtx);
  return (
    <button type="submit" disabled={pending} className={`${buttonClass(variant, size)} ${className ?? ""}`} {...props}>
      {pending ? "Saving…" : children}
    </button>
  );
}
