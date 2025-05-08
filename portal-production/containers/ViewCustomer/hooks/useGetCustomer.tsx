/* eslint-disable @typescript-eslint/no-explicit-any */
import { customerActions } from "@/containers/Customers/slice";
import { selectCustomer, selectIsGetCustomerLoading } from "@/containers/Customers/slice/selectors";
import { useAuth } from "@clerk/nextjs";
import { useParams } from "next/navigation";
import { useCallback, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";

export default function useGetCustomer() {
  const params = useParams();
  const rawId = params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const dispatch = useDispatch();
  const { getToken } = useAuth();
  const customer = useSelector(selectCustomer);
  const isGetCustomerLoading = useSelector(selectIsGetCustomerLoading);

  const getCustomer = useCallback(async () => {
    const token = await getToken();
    if (token && id) {
      dispatch(customerActions.getCustomerById({ id, token }));
    }
  }, [dispatch, getToken, id]);

  useEffect(() => {
    getCustomer();
  }, [getCustomer]);

  return { customer, isGetCustomerLoading };
}
