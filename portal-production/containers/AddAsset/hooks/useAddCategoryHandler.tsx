import { useDispatch, useSelector } from "react-redux";
import { assetsActions } from "@/containers/Assets/slice";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@clerk/nextjs";
import { selectCategoriesLoading, selectIsDeleteCategoryLoading, selectIsSkuCheckInProgress } from "@/containers/Assets/slice/selectors";
import useGetCategories from "./useGetCategories";

export default function useAddCategoryHandler() {
  const dispatch = useDispatch();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const { categories } = useGetCategories();
  const categoriesLoading = useSelector(selectCategoriesLoading);
  const deleteCategoryLoading = useSelector(selectIsDeleteCategoryLoading);
  const isSkuCheckInProgress = useSelector(selectIsSkuCheckInProgress);

  const handleAddCategory = async (categoryName: string) => {
    try {
      if (organizationId) {
        const token = await getToken();
        await dispatch(
          assetsActions.createCategory({
            name: categoryName,
            organizationId,
            token,
          })
        );
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error creating category:", error);
      return false;
    }
  };

  const handleDeleteCategory = async (id: string) => {
    try {
      if (organizationId) {
        const token = await getToken();
        await dispatch(
          assetsActions.deleteCategory({
            id: id,
            token,
          })
        );
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error deleting category:", error);
      return false;
    }
  };

  return { isSkuCheckInProgress, handleAddCategory, handleDeleteCategory, categories: categories || [], categoriesLoading, deleteCategoryLoading };
}
