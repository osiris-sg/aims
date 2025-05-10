/* eslint-disable @typescript-eslint/no-explicit-any */
import { ROUTES } from "@/routes";
import { useRouter } from "next/navigation";

export default function useEditDocumentHandler() {
  const router = useRouter();

  const handleEdit = async (row: any) => {
    router.push(`${ROUTES.EDIT_DOCUMENTS}/${row.type}/${row.id}`);
  };

  return {
    handleEdit,
  };
}
