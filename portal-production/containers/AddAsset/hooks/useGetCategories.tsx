import { useEffect, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { assetsActions } from "@/containers/Assets/slice";
import { selectCategories, selectCategoriesError, selectCategoriesLoading } from "@/containers/Assets/slice/selectors";
import { useOrganization } from "@clerk/nextjs";
import { useAuth } from "@clerk/nextjs";

export default function useGetCategories() {
  const dispatch = useDispatch();

  const loading = useSelector(selectCategoriesLoading);
  const error = useSelector(selectCategoriesError);
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const { getToken } = useAuth();
  const categories = useSelector(selectCategories);

  const getCategories = useCallback(async () => {
    if (organizationId) {
      const token = await getToken();
      dispatch(assetsActions.getCategories({ organizationId, token }));
    }
  }, [organizationId, dispatch, getToken]);
  useEffect(() => {
    if (organizationId) {
      getCategories();
    }
  }, [organizationId, getCategories]);

  return {
    loading,
    error,
    categories,
  };
}
