"use client";

import React, { forwardRef, useImperativeHandle, useRef } from "react";
import SignatureCanvas from "react-signature-canvas";
import { Box } from "@mui/material";

export interface SignaturePadHandle {
  /** True when nothing has been drawn yet. */
  isEmpty: () => boolean;
  /** Trimmed signature as a PNG data URL (empty string if the ref is unset). */
  toDataUrl: () => string;
  /** Wipe the canvas. */
  clear: () => void;
}

/**
 * Presentational signature pad — the react-signature-canvas box extracted
 * verbatim from the field sign page. Ref-based (the underlying library is
 * imperative): the caller holds a SignaturePadHandle and reads isEmpty()/
 * toDataUrl()/clear() on submit. No auth, no networking — identical rendering
 * for the field and guest flows.
 */
const SignaturePadField = forwardRef<SignaturePadHandle>(
  function SignaturePadField(_props, ref) {
    const sigRef = useRef<SignatureCanvas>(null);

    useImperativeHandle(ref, () => ({
      isEmpty: () => !sigRef.current || sigRef.current.isEmpty(),
      toDataUrl: () =>
        sigRef.current?.getTrimmedCanvas().toDataURL("image/png") ?? "",
      clear: () => sigRef.current?.clear(),
    }));

    return (
      <Box
        sx={{
          border: "1px dashed",
          borderColor: "divider",
          borderRadius: 1,
          bgcolor: "background.paper",
          touchAction: "none",
        }}
      >
        <SignatureCanvas
          ref={sigRef}
          penColor="black"
          canvasProps={{
            width: 360,
            height: 200,
            style: { width: "100%", height: 200 },
          }}
        />
      </Box>
    );
  },
);

export default SignaturePadField;
