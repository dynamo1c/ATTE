"use client";

import { ErrorView } from "@/components/error-view";

export default function ParentError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorView error={error} retry={retry} home="/parent" />;
}
