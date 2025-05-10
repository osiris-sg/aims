/* eslint-disable @typescript-eslint/no-explicit-any */
import { ROUTES } from "@/routes";
import { useRouter } from "next/navigation";

export default function useViewDocumentHandler() {
  const router = useRouter();

  const handleView = async (row: any) => {
    router.push(`${ROUTES.VIEW_DOCUMENTS}/${row.type}/${row.id}`);
  };

  return {
    handleView,
  };
}
