"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { toast } from "react-toastify";
import { acceptKinds, dragHasFiles, skippedMessage, splitDropped } from "@/helpers/fileDrop";

/**
 * Make any box a file drop zone (2026-11-03): `dragOver` drives the highlight,
 * `bind` goes on the box. Dropped files are filtered by the same `accept` list
 * as the box's file picker; the rest are skipped with a message, and the
 * accepted ones go to `onFiles` (the same handler the button uses).
 * While mounted it also stops a file dropped outside the box from making the
 * browser open it in place of the app.
 */
export function useFileDrop({ accept, onFiles, disabled = false }: { accept: string; onFiles: (files: File[]) => void; disabled?: boolean }) {
  const [dragOver, setDragOver] = useState(false);
  const depth = useRef(0); // dragenter / dragleave also fire for the box's children

  useEffect(() => {
    const stop = (e: DragEvent) => {
      if (dragHasFiles(e.dataTransfer)) e.preventDefault();
    };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !dragHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      depth.current += 1;
      setDragOver(true);
    },
    [disabled],
  );
  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !dragHasFiles(e.dataTransfer)) return;
      e.preventDefault(); // required (Chrome and Safari) for the drop to fire
      e.dataTransfer.dropEffect = "copy";
    },
    [disabled],
  );
  const onDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !dragHasFiles(e.dataTransfer)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragOver(false);
    },
    [disabled],
  );
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (!dragHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      depth.current = 0;
      setDragOver(false);
      if (disabled) return;
      const { accepted, skipped } = splitDropped(Array.from(e.dataTransfer.files || []), accept);
      const msg = skippedMessage(skipped, acceptKinds(accept));
      if (msg) toast.warn(msg);
      if (accepted.length) onFiles(accepted);
    },
    [accept, disabled, onFiles],
  );

  return { dragOver, bind: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}
