import { useDispatch, useSelector } from "react-redux";
import { inventoryActions } from "../slice";
import { useAuth } from "@clerk/nextjs";
import { selectIsQRLoading, selectQRCode } from "../slice/selectors";

export default function useViewQRHandler() {
  const dispatch = useDispatch();
  const { getToken } = useAuth();
  const isQRLoading = useSelector(selectIsQRLoading);
  const qrCode = useSelector(selectQRCode);

  const openQRDialog = async (sku: string) => {
    dispatch(inventoryActions.openQRDialog());
    const token = await getToken();
    if (token) {
      dispatch(inventoryActions.getQRCode({ sku: sku, token }));
    }
  };

  const closeQRDialog = () => {
    dispatch(inventoryActions.closeQRDialog());
  };

  return {
    openQRDialog,
    closeQRDialog,
    isQRLoading,
    qrCode,
  };
}
