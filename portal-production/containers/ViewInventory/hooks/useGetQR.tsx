/* eslint-disable @typescript-eslint/no-explicit-any */
import { inventoryActions } from "@/containers/Inventory/slice";
import { selectIsQRLoading, selectQRCode } from "@/containers/Inventory/slice/selectors";
import { useAuth } from "@clerk/nextjs";
import { useParams } from "next/navigation";
import { useCallback, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";

export default function useGetQR() {
  const params = useParams();
  const sku = params.sku;
  const dispatch = useDispatch();
  const { getToken } = useAuth();
  const isQRLoading = useSelector(selectIsQRLoading);
  const qrCode = useSelector(selectQRCode);

  const getQR = useCallback(async () => {
    const token = await getToken();
    if (token && sku) {
      dispatch(inventoryActions.getQRCode({ sku: sku as string, token }));
    }
  }, [dispatch, getToken, sku]);

  useEffect(() => {
    getQR();
  }, [getQR]);

  return { qrCode, isQRLoading };
}
