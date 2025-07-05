import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { useGetCategories } from "./useGetCategories";

export const useAddCategoryHandler = () => {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const { categories, refetch: refetchCategories } = useGetCategories();
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [deleteCategoryLoading, setDeleteCategoryLoading] = useState(false);

  const handleAddCategory = async (categoryName: string) => {
    try {
      if (!organizationId) return false;

      setCategoriesLoading(true);
      const token = await getToken();
      if (!token) return false;

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
        await refetchCategories();
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error creating category:", error);
      return false;
    } finally {
      setCategoriesLoading(false);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    try {
      if (!organizationId) return false;

      setDeleteCategoryLoading(true);
      const token = await getToken();
      if (!token) return false;

      const response = await request(
        {
          path: `/categories/${id}`,
          method: "DELETE",
        },
        {},
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
  };
};
