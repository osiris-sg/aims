import { customerActions } from "../slice";
import { useDispatch, useSelector } from "react-redux";
import { selectOpenDrawer } from "../slice/selectors";

export default function useAddCustomerStates() {
  const openDrawer = useSelector(selectOpenDrawer);
  const dispatch = useDispatch();
  const onAddClick = () => {
    dispatch(customerActions.setOpenDrawer(true));
  };

  const onCloseClick = () => {
    dispatch(customerActions.setOpenDrawer(false));
  };
  return { openDrawer, onAddClick, onCloseClick };
}
