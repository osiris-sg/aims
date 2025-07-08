import { useState } from "react";

export default function useAddOrganizationStates() {
  const [openDrawer, setOpenDrawer] = useState(false);

  const onAddClick = () => {
    setOpenDrawer(true);
  };

  const onCloseClick = () => {
    setOpenDrawer(false);
  };

  return {
    openDrawer,
    onAddClick,
    onCloseClick,
  };
}
