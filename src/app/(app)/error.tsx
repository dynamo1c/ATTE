"use client";

import { ErrorView } from "@/components/error-view";

export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorView error={error} retry={retry} />;
}
