import { useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";

export default function useSignatures() {
  const companySignatureRef = useRef<SignatureCanvas>(null);
  const customerSignatureRef = useRef<SignatureCanvas>(null);

  const [companySignature, setCompanySignature] = useState<string | null>(null);
  const [customerSignature, setCustomerSignature] = useState<string | null>(null);

  const saveSignature = (ref: React.RefObject<SignatureCanvas>, setState: React.Dispatch<React.SetStateAction<string | null>>) => {
    if (ref.current) {
      setState(ref.current.getTrimmedCanvas().toDataURL("image/png"));
    }
  };

  const clearSignature = (ref: React.RefObject<SignatureCanvas>, setState: React.Dispatch<React.SetStateAction<string | null>>) => {
    if (ref.current) {
      ref.current.clear();
      setState(null);
    }
  };
  return { companySignatureRef, customerSignatureRef, companySignature, customerSignature, setCompanySignature, setCustomerSignature, saveSignature, clearSignature };
}
