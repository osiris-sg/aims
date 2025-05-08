import { useDispatch, useSelector } from "react-redux";
import { customerActions } from "../slice";
import { selectDeleteingCustomerId, selectIsCustomerDeleteInProgress } from "../slice/selectors";
import { useAuth } from "@clerk/nextjs";
export default function useDeleteCustomerHandler() {
  const dispatch = useDispatch();
  const { getToken } = useAuth();
  const setCustomerToDelete = (id: string | null) => {
    dispatch(customerActions.setCustomerToDelete(id));
  };
  const customerToDelete = useSelector(selectDeleteingCustomerId);
  const isDeleteInProgress = useSelector(selectIsCustomerDeleteInProgress);
  const onDeleteConfirm = async () => {
    const token = await getToken();
    if (token && customerToDelete) {
      dispatch(customerActions.deleteCustomer({ id: customerToDelete, token }));
    }
  };
  return {
    setCustomerToDelete,
    customerToDelete,
    isDeleteInProgress,
    onDeleteConfirm,
  };
}
