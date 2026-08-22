import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  linkUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

const EMPTY = { items: [] as NotificationItem[], unread: 0 };

// Header-bell feed. Polls so a DO/invoice created by a completing delivery
// surfaces to the office without a manual refresh. Scoped to the active org
// (the request helper injects X-Active-Org-Id for admins viewing as an org).
export function useNotifications() {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  const { data = EMPTY, refetch } = useQuery({
    queryKey: ["notifications", organizationId],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !organizationId) return EMPTY;
        const res = await request({ path: "/notifications", method: "GET" }, {}, token);
        const payload = res?.data ?? res;
        return {
          items: (payload?.items ?? []) as NotificationItem[],
          unread: (payload?.unread ?? 0) as number,
        };
      } catch {
        return EMPTY;
      }
    },
    enabled: !!organizationId,
    refetchInterval: 45000,
    refetchOnWindowFocus: true,
  });

  return { items: data.items, unread: data.unread, refetch };
}

export function useMarkNotificationRead() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      if (!token) throw new Error("No authentication token available");
      return request({ path: `/notifications/${id}/read`, method: "POST" }, {}, token);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useMarkAllNotificationsRead() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("No authentication token available");
      return request({ path: "/notifications/read-all", method: "POST" }, {}, token);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}
