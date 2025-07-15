import { useState } from "react";

export default function useAddOrganizationStates() {
  const [openOrganizationDrawer, setOpenOrganizationDrawer] = useState(false);

  const onAddOrganizationClick = () => {
    setOpenOrganizationDrawer(true);
  };

  const onCloseOrganizationClick = () => {
    setOpenOrganizationDrawer(false);
  };

  return {
    openOrganizationDrawer,
    onAddOrganizationClick,
    onCloseOrganizationClick,
  };
}
