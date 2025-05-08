import { useRef } from "react";
import { useReactToPrint } from "react-to-print";

export default function usePrintDocumentHandler() {
  const contentRef = useRef(null);

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
  return { handlePrint, contentRef };
}
