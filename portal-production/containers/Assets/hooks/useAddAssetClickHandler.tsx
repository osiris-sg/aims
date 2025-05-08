"use client";

import { ROUTES } from "@/routes";
import { useRouter } from "next/navigation";

export default function useAddAssetClickHandler() {
  const router = useRouter();

  const onAddClick = () => {
    router.push(ROUTES.ADD_ASSET);
  };

  return { onAddClick };
}
