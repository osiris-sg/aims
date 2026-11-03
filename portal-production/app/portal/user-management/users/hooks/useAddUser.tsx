import { useState } from "react";
import { request } from "@/helpers/request";
import { useAuth } from "@clerk/nextjs";

interface CreateUserData {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  password?: string;
  roleIds: string[];
  salesmanCode?: string;
  salesmanMobile?: string;
}

export default function useAddUserStates() {
  const [openDrawer, setOpenDrawer] = useState(false);
  const [loading, setLoading] = useState(false);
  const { getToken } = useAuth();

  const onAddClick = () => {
    setOpenDrawer(true);
  };

  const onCloseClick = () => {
    setOpenDrawer(false);
  };

  const createUser = async (userData: CreateUserData) => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        throw new Error("No authentication token available");
      }

      // Add user (2026-11-03): an existing login (by email or mobile, any org) only gets this
      // org's membership + roles; a new one is made. The reply is the same text either way.
      const response = await request(
        {
          method: "POST",
          path: "/users/members/add-member",
        },
        userData,
        token
      );

      if (!response.success) {
        throw new Error(response.message || "Failed to create user");
      }

      return response;
    } catch (error) {
      console.error("Error creating user:", error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  return {
    openDrawer,
    onAddClick,
    onCloseClick,
    createUser,
    loading,
  };
}
