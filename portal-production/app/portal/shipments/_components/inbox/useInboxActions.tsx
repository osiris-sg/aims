/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round W — the inbox actions behind the question cards and the thread timeline: one-tap answers (with Undo),
// "New deal → Create order" (prefilled from the thread's PI / seed), the picker ("Change order" / "This one is
// different"), Undo of a processed email, and the timeline dialog. Shared by the Dashboard and "See all emails".

import React, { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useShipmentsApi, type InboxAnswer, type InboxAnswerResult, type InboxLang, type InboxMessage, type InboxRow, type InboxThread, type OrderSeed, type PiExtraction } from "../../_lib/api";
import OrderFormDialog from "../OrderFormDialog";
import { useTradeMutation } from "../../_lib/hooks";
import { toast } from "../../_lib/toast";
import { uiLangOf } from "../../_lib/inbox-cards";
import { ConfirmDialog } from "../bits";
import { PickerDialog } from "./InboxPicker";
import { InboxDetailsDialog } from "./InboxDetails";
import type { InboxActions } from "./InboxThreadList";

export type InboxAct = "undo" | "dismiss" | "retriage" | "ignore";

/** The cards' language: the browser's (Japanese or English). */
export function useInboxLang(): InboxLang {
  const [lang, setLang] = useState<InboxLang>("en");
  useEffect(() => {
    setLang(uiLangOf(typeof navigator !== "undefined" ? navigator.language : null));
  }, []);
  return lang;
}

export function useInboxActions(onChanged: () => Promise<unknown> | void) {
  const qc = useQueryClient();
  const api = useShipmentsApi();
  const lang = useInboxLang();
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
  const createOrder = async (t: InboxThread) => {
    const withPi = t.messages.find((m) => m.attachments.some((a) => a.docType === "PI" || /\bPI\b|_PI_/i.test(a.name)));
    const seed = t.messages.map((m) => m.backlog?.seed).find(Boolean) ?? null;
    if (withPi) {
      setCreating(true);
      try {
        const pre = await api.inboxPiPrefill(withPi.id);
        setCreate({ prefill: pre, seed });
        return;
      } catch (e: any) {
        toast.error(e?.message || "Could not read the PI — starting from the thread's details");
      } finally {
        setCreating(false);
      }
    }
    setCreate({ prefill: null, seed });
  };
  /** One tap: answer for every unprocessed email of the thread. */
  const answer = async (t: InboxThread, a: InboxAnswer): Promise<InboxAnswerResult | null> => {
    const ids = t.answerIds?.length ? t.answerIds : t.messages.filter((m) => m.inboxState !== "PROCESSED").map((m) => m.id);
    if (!ids.length) return null;
    setAnswering(true);
    try {
      const r = await api.inboxAnswer(ids, a, lang);
      toast.success(r.text);
      await refresh();
      return r;
    } catch (e: any) {
      toast.error(e?.message || "Could not do that");
      return null;
    } finally {
      setAnswering(false);
    }
  };
  const answerUndo = async (r: InboxAnswerResult) => {
    try {
      await api.inboxAnswerUndo(r.ids, r.kind);
      toast.success(lang === "ja" ? "元に戻しました" : "Undone");
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || "Could not undo");
    }
  };
  const act = useTradeMutation((a, v: { id: string; act: InboxAct }): Promise<unknown> => (v.act === "undo" ? a.inboxUndo(v.id) : v.act === "dismiss" ? a.inboxDismiss(v.id) : v.act === "ignore" ? a.inboxIgnore(v.id) : a.inboxRetriage(v.id)));
  const run = async (row: InboxRow, what: InboxAct) => {
    try {
      await act.mutateAsync({ id: row.id, act: what });
      toast.success(what === "undo" ? (lang === "ja" ? "元に戻しました — 未処理へ" : "Undone — back to Unprocessed") : what === "dismiss" ? "Removed (not shipment mail)" : what === "ignore" ? "Ignored — kept, nothing filed" : "Triaged again");
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || "Could not do that");
    }
  };
  const pending = act.isPending || creating || answering;
  const actions: InboxActions = {
    lang,
    onAnswer: answer,
    onAnswerUndo: answerUndo,
    onCreateOrder: (t) => void createOrder(t),
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
        onAnswer={async (t, a) => {
          const r = await answer(t, a);
          return r;
        }}
        onAnswerUndo={answerUndo}
        onCreateOrder={(t) => {
          setOpen(null);
          void createOrder(t);
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
          toast.success(lang === "ja" ? "注文を作成しました — このスレッドのメールは次回の照合で紐付きます" : "Order created — the thread's emails will match it on the next re-match");
          await refresh();
        }}
      />
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.act === "undo" ? "Undo what this email did?" : "Delete this email (not shipment mail)?"}
        body={
          confirm?.act === "undo"
            ? "Its files are removed (steps they completed are reopened), the fields it filled are cleared and its sub-tasks unticked. The email goes back to Unprocessed."
            : "The stored email and its attachments are deleted; only a fingerprint of its Message-ID is kept so it isn't stored again."
        }
        confirmLabel={confirm?.act === "undo" ? "Undo" : "Delete"}
        destructive
        onClose={() => setConfirm(null)}
        onConfirm={() => run(confirm!.row, confirm!.act)}
      />
    </>
  );
  return { lang, run, pending, actions, open, setOpen, assign, setAssign, confirm, setConfirm, createOrder, answer, answerUndo, dialogs };
}
