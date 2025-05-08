/* eslint-disable @typescript-eslint/no-explicit-any */
import { ROUTES } from "@/routes";
import { useRouter } from "next/navigation";

export default function useViewAssetHandler() {
  const router = useRouter();

  const handleView = async (row: any) => {
    router.push(`${ROUTES.ASSETS}/${row.skuKey}`);
  };

  return {
    handleView,
  };
}
