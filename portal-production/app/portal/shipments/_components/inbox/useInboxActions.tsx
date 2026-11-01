/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round W — the inbox actions behind the question cards and the thread timeline: one-tap answers (with Undo),
// "New deal → Create order" (prefilled from the thread's PI / seed), the picker ("Change order" / "This one is
// different"), Undo of a processed email, and the timeline dialog. Shared by the Dashboard and "See all emails".

import { useUiLang } from "@/i18n/UiLangProvider";
import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useShipmentsApi, type InboxAnswer, type InboxAnswerResult, type InboxLang, type InboxMessage, type InboxRow, type InboxThread, type OrderSeed, type PiExtraction } from "../../_lib/api";
import OrderFormDialog from "../OrderFormDialog";
import { useTradeMutation } from "../../_lib/hooks";
import { toast } from "../../_lib/toast";
import { ConfirmDialog } from "../bits";
import { PickerDialog } from "./InboxPicker";
import { InboxDetailsDialog } from "./InboxDetails";
import type { InboxActions } from "./InboxThreadList";

export type InboxAct = "undo" | "dismiss" | "retriage" | "ignore";

/** The cards' language: the portal language (round AZ: the user's EN / 日本語 switch). */
export function useInboxLang(): InboxLang {
  return useUiLang().lang;
}

export function useInboxActions(onChanged: () => Promise<unknown> | void) {
  const qc = useQueryClient();
  const api = useShipmentsApi();
  const lang = useInboxLang();
  const t = useTranslations("inbox.actions");
  const [confirm, setConfirm] = useState<{ row: InboxRow; act: "undo" | "dismiss" } | null>(null);
  const [open, setOpen] = useState<{ row: InboxRow; thread: InboxThread | null } | null>(null);
  const [assign, setAssign] = useState<InboxRow | null>(null);
  const [create, setCreate] = useState<{ prefill: PiExtraction | null; seed: OrderSeed | null } | null>(null);
  const [creating, setCreating] = useState(false);
  const [answering, setAnswering] = useState(false);
  const refresh = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ["trade-inbox"] }), onChanged()]);
  };
  // "New deal → Create order": from the thread's PI attachment (the PI extractor) when there is one, else from the seed.
  // Round AF: the REAL proforma invoice, not a remittance statement that mentions "PI" in its name (that read came back
  // empty and the form opened blank); typed PI attachments first, then PI-looking names; a read with no PI number and
  // no lines is skipped and the next candidate tried; the thread's seed fills whatever the PI left blank.
  const isPiName = (n: string) => /\bPI\b|_PI_|proforma/i.test(n) && !/remittance|statement|deposit|slip|\bTT\b|payment|receipt|wise|invoice[-_ ]?\d/i.test(n);
  const createOrder = async (th: InboxThread) => {
    const seed = th.messages.map((m) => m.backlog?.seed).find(Boolean) ?? null;
    const candidates = th.messages
      .flatMap((m) => m.attachments.filter((a) => a.docType === "PI" || isPiName(a.name)).map((a) => ({ m, a })))
      .sort((x, y) => Number(y.a.docType === "PI") - Number(x.a.docType === "PI"));
    if (candidates.length) {
      setCreating(true);
      try {
        for (const c of candidates.slice(0, 3)) {
          const pre = await api.inboxPiPrefill(c.m.id).catch(() => null);
          const d = pre?.result?.draft as { piNumber?: string | null; lines?: unknown[] } | undefined;
          if (pre && d && (d.piNumber || d.lines?.length)) {
            setCreate({ prefill: pre, seed });
            return;
          }
        }
        toast.info(t("noPi"));
      } finally {
        setCreating(false);
      }
    }
    setCreate({ prefill: null, seed });
  };
  /** One tap: answer for every unprocessed email of the thread. */
  const answer = async (th: InboxThread, a: InboxAnswer): Promise<InboxAnswerResult | null> => {
    const ids = th.answerIds?.length ? th.answerIds : th.messages.filter((m) => m.inboxState !== "PROCESSED").map((m) => m.id);
    if (!ids.length) return null;
    setAnswering(true);
    try {
      const r = await api.inboxAnswer(ids, a, lang);
      toast.success(r.text);
      await refresh();
      return r;
    } catch (e: any) {
      toast.error(e?.message || t("couldNotDo"));
      return null;
    } finally {
      setAnswering(false);
    }
  };
  const answerUndo = async (r: InboxAnswerResult) => {
    try {
      await api.inboxAnswerUndo(r.ids, r.kind);
      toast.success(t("undone"));
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || t("couldNotUndo"));
    }
  };
  const act = useTradeMutation((a, v: { id: string; act: InboxAct }): Promise<unknown> => (v.act === "undo" ? a.inboxUndo(v.id) : v.act === "dismiss" ? a.inboxDismiss(v.id) : v.act === "ignore" ? a.inboxIgnore(v.id) : a.inboxRetriage(v.id)));
  const run = async (row: InboxRow, what: InboxAct) => {
    try {
      await act.mutateAsync({ id: row.id, act: what });
      toast.success(what === "undo" ? t("undoneBack") : what === "dismiss" ? t("removed") : what === "ignore" ? t("ignored") : t("triaged"));
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || t("couldNotDo"));
    }
  };
  const pending = act.isPending || creating || answering;
  const actions: InboxActions = {
    lang,
    onAnswer: answer,
    onAnswerUndo: answerUndo,
    onCreateOrder: (th) => void createOrder(th),
    onOpen: (m: InboxMessage, t?: InboxThread) => setOpen({ row: m, thread: t ?? null }),
    onUndo: (m) => setConfirm({ row: m, act: "undo" }),
    pending,
  };
  const dialogs = (
    <>
      <InboxDetailsDialog
        open={open?.row ?? null}
        thread={open?.thread ?? null}
        lang={lang}
        onClose={() => setOpen(null)}
        onAnswer={async (th, a) => {
          const r = await answer(th, a);
          return r;
        }}
        onAnswerUndo={answerUndo}
        onCreateOrder={(th) => {
          setOpen(null);
          void createOrder(th);
        }}
        onChangeOrder={(r) => setAssign(r)}
        onUndo={(r) => setConfirm({ row: r, act: "undo" })}
        pending={pending}
        onRowChanged={(r) => setOpen((o) => (o ? { ...o, row: r } : o))}
      />
      <PickerDialog
        row={assign}
        onClose={() => setAssign(null)}
        onDone={async () => {
          setAssign(null);
          await refresh();
        }}
      />
      <OrderFormDialog
        open={!!create}
        onClose={() => setCreate(null)}
        prefill={create?.prefill ?? null}
        seed={create?.seed ?? null}
        onSaved={async () => {
          setCreate(null);
          toast.success(t("orderCreated"));
          await refresh();
        }}
      />
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.act === "undo" ? t("undoTitle") : t("deleteTitle")}
        body={
          confirm?.act === "undo"
            ? t("undoBody")
            : t("deleteBody")
        }
        confirmLabel={confirm?.act === "undo" ? t("undo") : t("delete")}
        destructive
        onClose={() => setConfirm(null)}
        onConfirm={() => run(confirm!.row, confirm!.act)}
      />
    </>
  );
  return { lang, run, pending, actions, open, setOpen, assign, setAssign, confirm, setConfirm, createOrder, answer, answerUndo, dialogs };
}
