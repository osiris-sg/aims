import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useSelector } from "react-redux";
import { selectInventory } from "@/containers/Inventory/slice/selectors";

export default function useUpdateStatus() {
  const { control, setValue } = useForm({});
  const inventory = useSelector(selectInventory);
  useEffect(() => {
    if (inventory?.status) {
      setValue("status", inventory.status);
    }
  }, [inventory?.status, setValue]);

  return { control };
}
