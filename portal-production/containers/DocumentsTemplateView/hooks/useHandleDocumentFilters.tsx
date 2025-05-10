import { useState } from "react";

export default function useHandleDocumentFilters() {
  const [openFilters, setOpenFilters] = useState(false);
  return { openFilters, setOpenFilters };
}
