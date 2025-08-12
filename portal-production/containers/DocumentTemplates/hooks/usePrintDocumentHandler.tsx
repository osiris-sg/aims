import { useRef, useEffect } from "react";
import { useReactToPrint } from "react-to-print";
import { useSearchParams } from "next/navigation";

export default function usePrintDocumentHandler() {
  const contentRef = useRef(null);
  const searchParams = useSearchParams();
  const autoprint = searchParams.get("autoprint") === "true";

  const handlePrint = useReactToPrint({
    contentRef,
    pageStyle: `
      @page {
      size: A4;
      margin: 0; /* Removes default browser margins */
    }
    @media print {
      body {
        -webkit-print-color-adjust: exact; /* Ensures colors print properly */
        print-color-adjust: exact;
      }
      /* Hide headers and footers */
      @page {
        margin: 0;
      }
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
      }
    }
  `,
  });

  // Auto-trigger print if autoprint parameter is present
  useEffect(() => {
    if (autoprint && contentRef.current) {
      // Add a delay to ensure content is fully rendered
      const timer = setTimeout(() => {
        handlePrint();
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [autoprint, handlePrint]);

  return { handlePrint, contentRef };
}
