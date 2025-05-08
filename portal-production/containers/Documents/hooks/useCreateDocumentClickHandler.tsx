"use client";

import { ROUTES } from "@/routes";
import { useRouter } from "next/navigation";

export default function useCreateDocumentClickHandler() {
  const router = useRouter();

  const onAddClick = () => {
    router.push(ROUTES.CREATE_DOCUMENT);
  };

  return { onAddClick };
}
