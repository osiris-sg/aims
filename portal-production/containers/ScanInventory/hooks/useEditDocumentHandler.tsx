/* eslint-disable @typescript-eslint/no-explicit-any */
import { ROUTES } from "@/routes";
import { useRouter } from "next/navigation";

export default function useEditDocumentHandler() {
  const router = useRouter();

  const handleEdit = async (template: any, inventory: any) => {
    router.push(`${ROUTES.EDIT_DOCUMENTS}/${template.type}/${template.id}?scannedInventoryId=${inventory.id}`);
  };

  return {
    handleEdit,
  };
}
