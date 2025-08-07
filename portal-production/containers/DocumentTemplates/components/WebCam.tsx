"use client";

import React, { useRef, useCallback } from "react";
import Webcam from "react-webcam";

export default function WebcamComponent({ onCapture }: { onCapture: (image: string) => void }) {
  const webcamRef = useRef(null);

  const capture = useCallback(() => {
    if (webcamRef.current) {
      const imageSrc = (webcamRef.current as any).getScreenshot();
      if (imageSrc) {
        onCapture(imageSrc);
      }
    }
  }, [webcamRef, onCapture]);

  return (
    <div>
      <Webcam
        ref={webcamRef}
        screenshotFormat="image/jpeg"
        videoConstraints={{
          facingMode: "user", // front camera
        }}
      />
      <button onClick={capture}>Capture</button>
    </div>
  );
}
