import { useState } from "react";

export default function useHandleAssetFilter() {
  const [openFilters, setOpenFilters] = useState(false);
  return { openFilters, setOpenFilters };
}
