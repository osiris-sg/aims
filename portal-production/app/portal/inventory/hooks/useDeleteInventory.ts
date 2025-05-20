import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrganization, useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { useNotifications } from "../../hooks/useNotifications";

interface DeleteInventoryParams {
  id: string;
}

export default function useDeleteInventory() {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const { showNotification } = useNotifications();
  const organizationId = organization?.id;

  const { mutate: deleteInventory, isPending: isDeleting } = useMutation({
    mutationFn: async ({ id }: DeleteInventoryParams) => {
      const token = await getToken();
      if (!token || !organizationId) throw new Error("No token or organization ID");

      const response = await request(
        {
          path: "/inventories/delete",
          method: "DELETE",
        },
        {
          id,
          organizationId,
        },
        token
      );

      if (!response.success) {
        throw new Error(response.message || "Failed to delete inventory");
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventories"] });
      showNotification({
        message: "Inventory deleted successfully",
        type: "success",
      });
    },
    onError: (error: Error) => {
      showNotification({
        message: error.message || "Failed to delete inventory",
        type: "error",
      });
    },
  });

  return {
    deleteInventory,
    isDeleting,
  };
}
