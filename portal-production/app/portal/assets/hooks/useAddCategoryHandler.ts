import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "../../hooks/useOrganization";
import { request } from "@/helpers/request";
import { useGetCategories } from "./useGetCategories";

export const useAddCategoryHandler = () => {
  const { getToken } = useAuth();
  const { organization: organization } = useOrganization();

  // Use Clerk organization first, then fallback to backend organization for OsirisAdmin
  const organizationId = organization?.id;

  const { categories, refetch: refetchCategories } = useGetCategories();
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [deleteCategoryLoading, setDeleteCategoryLoading] = useState(false);

  const handleAddCategory = async (categoryName: string) => {
    try {
      if (!organizationId) {
        console.error("No organization context available. Please ensure you're assigned to an organization.");
        return false;
      }

      setCategoriesLoading(true);
      const token = await getToken();
      if (!token) {
        console.error("No authentication token available");
        return false;
      }

      console.log("Creating category:", categoryName, "for organization:", organizationId);

      const response = await request(
        {
          path: "/categories/create",
          method: "POST",
        },
        {
          name: categoryName,
        },
        token
      );

      if (response.success) {
        console.log("Category created successfully");
        await refetchCategories();
        return true;
      } else {
        console.error("Failed to create category:", response);
        return false;
      }
    } catch (error) {
      console.error("Error creating category:", error);
      return false;
    } finally {
      setCategoriesLoading(false);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    try {
      if (!organizationId) {
        console.error("No organization context available");
        return false;
      }

      setDeleteCategoryLoading(true);
      const token = await getToken();
      if (!token) {
        console.error("No authentication token available");
        return false;
      }

      const response = await request(
        {
          path: "/categories/delete",
          method: "DELETE",
        },
        {
          id: id,
        },
        token
      );

      if (response.success) {
        await refetchCategories();
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error deleting category:", error);
      return false;
    } finally {
      setDeleteCategoryLoading(false);
    }
  };

  return {
    handleAddCategory,
    handleDeleteCategory,
    categories: categories || [],
    categoriesLoading,
    deleteCategoryLoading,
    organizationId, // Expose for debugging
  };
};
