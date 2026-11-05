"use client";

// Round BF (Sayaka, 2026-11-04: she cancelled #30 and could not get it back): one "Reopen order" for every place that
// shows a cancelled order — the Orders list row, the order page banner and the New order form's "already on #30"
// notes. Always behind a confirm; the order goes back to Pending with its steps, shipments and documents as they were.

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "../_lib/toast";
import { useTradeMutation } from "../_lib/hooks";
import { ConfirmDialog } from "./bits";

export type ReopenTarget = { id: string; label: string };

/** `ask(order)` opens the confirm; render `dialog` once. `openAfter`: go to the order page once reopened. */
export function useReopenOrder(o: { openAfter?: boolean; onDone?: (t: ReopenTarget) => void } = {}) {
  const t = useTranslations("orders.reopen");
  const router = useRouter();
  const [target, setTarget] = useState<ReopenTarget | null>(null);
  const reopen = useTradeMutation((api, id: string) => api.reopenOrder(id));
  const dialog = (
    <ConfirmDialog
      open={!!target}
      title={t("title", { label: target?.label ?? "" })}
      body={t("body")}
      confirmLabel={t("confirm")}
      onClose={() => setTarget(null)}
      onConfirm={async () => {
        const x = target!;
        await reopen.mutateAsync(x.id);
        toast.success(t("done", { label: x.label }));
        o.onDone?.(x);
        if (o.openAfter) router.push(`/portal/shipments/orders/${x.id}`);
      }}
    />
  );
  return { ask: (x: ReopenTarget) => setTarget(x), dialog };
}
