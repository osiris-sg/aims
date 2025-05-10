import { inventoryActions } from "../slice";
import { useDispatch, useSelector } from "react-redux";
import { selectOpenDrawer } from "../slice/selectors";

export default function useAddInventoryStates() {
  const openDrawer = useSelector(selectOpenDrawer);
  const dispatch = useDispatch();
  const onAddClick = () => {
    dispatch(inventoryActions.setOpenDrawer(true));
  };

  const onCloseClick = () => {
    dispatch(inventoryActions.setOpenDrawer(false));
  };
  return { openDrawer, onAddClick, onCloseClick };
}
