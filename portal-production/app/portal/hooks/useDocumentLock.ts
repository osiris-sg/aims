"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { request } from "@/helpers/request";

/**
 * Concurrent-edit guard for the document editor.
 *
 * On open, claims the document's edit lock:
 *  - free / already mine  → claimed, you edit normally.
 *  - someone else active    → read-only (no takeover); banner names the editor.
 *  - holder idle > 5 min    → read-only + "Take over" (must click to claim).
 *
 * One interval drives the lifecycle. If I'm the holder it HEARTBEATS (keeping the
 * lock alive; `markEdited()` bumps the idle clock so a tab left open still goes
 * idle). If I'm only a waiting viewer it POLLS (re-attempts a non-takeover claim,
 * which silently succeeds the moment the holder leaves, and otherwise refreshes
 * the banner as the holder goes idle).
 *
 * The lock is self-healing: a heartbeat only surrenders to ANOTHER user. A lock
 * found free (a transient release / dev HMR remount) is simply re-claimed, so a
 * hiccup never falsely flips the active editor to read-only.
 */

const HEARTBEAT_MS = 25_000;

export interface UseDocumentLock {
  isReadOnly: boolean;
  canTakeOver: boolean;
  holderName: string | null;
  lostLock: boolean;
  version: number;
  setVersion: (v: number) => void;
  refreshVersion: () => void;
  takeOver: () => Promise<void>;
  markEdited: () => void;
  release: () => void;
}

export function useDocumentLock(documentId?: string | null, enabled: boolean = true): UseDocumentLock {
  const { getToken } = useAuth();
  const { user } = useUser();
  const userName =
    user?.fullName ||
    user?.firstName ||
    user?.username ||
    user?.emailAddresses?.[0]?.emailAddress ||
    "Someone";

  const [isReadOnly, setIsReadOnly] = useState(false);
  const [canTakeOver, setCanTakeOver] = useState(false);
  const [holderName, setHolderName] = useState<string | null>(null);
  const [lostLock, setLostLock] = useState(false);
  const [version, setVersion] = useState(0);

  const editedRef = useRef(false);
  const releasedRef = useRef(false);
  const isHolderRef = useRef(false); // am I the current lock holder?
  const userNameRef = useRef(userName);
  userNameRef.current = userName;

  // Apply an acquire/poll response: acquired === true means I hold it (editable);
  // otherwise read-only, surfacing why (active holder vs idle → takeover).
  const applyAcquire = useCallback((res: any) => {
    // [doclock] diagnostic — remove once the false-lock issue is understood.
    // eslint-disable-next-line no-console
    console.log("[doclock] applyAcquire", { documentId, acquired: res?.acquired, storedHolderId: res?.editingByUserId, storedHolderName: res?.editingByName, canTakeOver: res?.canTakeOver, heldByMe: res?.heldByMe });
    if (typeof res?.version === "number") setVersion(res.version);
    if (res?.acquired) {
      isHolderRef.current = true;
      setIsReadOnly(false);
      setCanTakeOver(false);
      setHolderName(null);
      setLostLock(false);
    } else {
      isHolderRef.current = false;
      setIsReadOnly(true);
      setCanTakeOver(!!res?.canTakeOver);
      setHolderName(res?.editingByName || "another user");
    }
  }, [documentId]);

  const callAcquire = useCallback(
    async (takeover: boolean) => {
      if (!documentId) return null;
      const token = await getToken();
      if (!token) return null;
      const res = await request(
        { path: `/documents/${documentId}/lock`, method: "PATCH" },
        { userName: userNameRef.current, takeover },
        token,
      );
      if (!res || res.success === false) return null;
      // Backend responses are wrapped by CustomResponseInterceptor as
      // { success, data, message } — the lock state lives under .data.
      return res.data ?? res;
    },
    [documentId, getToken],
  );

  const heartbeat = useCallback(
    async (edited: boolean) => {
      if (!documentId || releasedRef.current) return;
      const token = await getToken();
      if (!token) return;
      const res = await request(
        { path: `/documents/${documentId}/lock/heartbeat`, method: "PATCH" },
        { edited, userName: userNameRef.current },
        token,
      );
      if (!res || res.success === false) return;
      // Unwrap the { success, data, message } envelope (see callAcquire).
      const body = res.data ?? res;
      if (body.lostLock) {
        // Someone genuinely took over — drop to read-only viewer/poller.
        isHolderRef.current = false;
        setLostLock(true);
        setIsReadOnly(true);
        setCanTakeOver(!!body.canTakeOver);
        setHolderName(body.editingByName || "another user");
      } else {
        // Still mine (or re-claimed a lapsed lock) — self-heal any stale banner.
        isHolderRef.current = true;
        setLostLock(false);
        setIsReadOnly(false);
        setCanTakeOver(false);
        setHolderName(null);
        if (typeof body.version === "number") setVersion(body.version);
      }
    },
    [documentId, getToken],
  );

  // Acquire on open.
  useEffect(() => {
    if (!documentId || !enabled) return;
    releasedRef.current = false;
    let cancelled = false;
    (async () => {
      const res = await callAcquire(false);
      if (cancelled || !res) return;
      applyAcquire(res);
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId, enabled, callAcquire, applyAcquire]);

  // One interval: holder heartbeats, waiting viewer polls.
  useEffect(() => {
    if (!documentId || !enabled) return;
    const id = setInterval(() => {
      if (releasedRef.current) return;
      if (isHolderRef.current) {
        const edited = editedRef.current;
        editedRef.current = false;
        void heartbeat(edited);
      } else {
        void callAcquire(false).then((res) => {
          if (res) applyAcquire(res);
        });
      }
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [documentId, enabled, heartbeat, callAcquire, applyAcquire]);

  const release = useCallback(() => {
    if (!documentId || releasedRef.current) return;
    releasedRef.current = true;
    isHolderRef.current = false;
    getToken().then((token) => {
      if (!token) return;
      request({ path: `/documents/${documentId}/lock`, method: "DELETE" }, {}, token).catch(() => {});
    });
  }, [documentId, getToken]);

  // Release on unmount.
  useEffect(() => {
    return () => {
      if (documentId && enabled) release();
    };
  }, [documentId, enabled, release]);

  const takeOver = useCallback(async () => {
    const res = await callAcquire(true);
    if (res) applyAcquire(res);
  }, [callAcquire, applyAcquire]);

  const refreshVersion = useCallback(() => {
    // Holder re-pulls the bumped version after a save; viewer just re-polls.
    if (isHolderRef.current) void heartbeat(false);
    else void callAcquire(false).then((res) => res && applyAcquire(res));
  }, [heartbeat, callAcquire, applyAcquire]);

  const markEdited = useCallback(() => {
    editedRef.current = true;
  }, []);

  return {
    isReadOnly,
    canTakeOver,
    holderName,
    lostLock,
    version,
    setVersion,
    refreshVersion,
    takeOver,
    markEdited,
    release,
  };
}
