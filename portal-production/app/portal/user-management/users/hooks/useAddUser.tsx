import { useState } from "react";
import { request } from "@/helpers/request";
import { useAuth } from "@clerk/nextjs";

interface CreateUserData {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  roleIds: string[];
  salesmanCode?: string;
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

      const response = await request(
        {
          method: "POST",
          path: "/users",
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
