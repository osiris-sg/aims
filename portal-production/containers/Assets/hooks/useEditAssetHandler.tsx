/* eslint-disable @typescript-eslint/no-explicit-any */
import { ROUTES } from "@/routes";
import { useRouter } from "next/navigation";

export default function useEditAssetHandler() {
  const router = useRouter();

  const handleEdit = async (row: any) => {
    router.push(`${ROUTES.EDIT_ASSET}/${row.id}`);
  };
  return {
    handleEdit,
  };
}
