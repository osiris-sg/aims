import { useState } from "react";

export default function useHandleCustomerFilters() {
  const [openFilters, setOpenFilters] = useState(false);
  return { openFilters, setOpenFilters };
}
