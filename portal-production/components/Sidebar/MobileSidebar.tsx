import * as React from "react";
import PropTypes from "prop-types";
import Divider from "@mui/material/Divider";
import Drawer, { drawerClasses } from "@mui/material/Drawer";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { Box } from "@mui/material";
import { UserButton, useUser } from "@clerk/nextjs";
import SideBarContent from "./SideBarContent";

interface Props {
  open: boolean;
  toggleDrawer: (value: boolean) => void;
}
function MobileSideBar({ open, toggleDrawer }: Props) {
  const { user } = useUser();
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={() => toggleDrawer(false)}
      sx={{
        zIndex: (theme) => theme.zIndex.drawer + 1,
        [`& .${drawerClasses.paper}`]: {
          backgroundImage: "none",
          backgroundColor: "#041627",
          color: "#FFFFFF",
        },
      }}
    >
      <Stack
        sx={{
          maxWidth: "70dvw",
          height: "100%",
        }}
      >
        <Stack direction="row" sx={{ p: 2, gap: 1 }}>
          <UserButton afterSignOutUrl="/" />
          <Box sx={{ mr: "auto" }}>
            <Typography variant="body2" sx={{ fontWeight: 700, color: "#FFFFFF" }}>
              {user?.fullName}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                width: 200,
                color: "rgba(255, 255, 255, 0.7)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {user?.emailAddresses[0]?.emailAddress}
            </Typography>
          </Box>
        </Stack>
        <Divider />
        <Stack sx={{ flexGrow: 1 }}>
          <SideBarContent />
          <Divider />
        </Stack>
      </Stack>
    </Drawer>
  );
}

MobileSideBar.propTypes = {
  open: PropTypes.bool,
  toggleDrawer: PropTypes.func.isRequired,
};

export default MobileSideBar;
