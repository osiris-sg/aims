"use client";
import * as React from "react";
import { styled, useTheme } from "@mui/material/styles";
import Avatar from "@mui/material/Avatar";
import MuiDrawer, { drawerClasses } from "@mui/material/Drawer";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import SideBarContent from "./SideBarContent";
import { UserButton, useUser } from "@clerk/nextjs";
// import SelectContent from './SelectContent';
// import MenuContent from './MenuContent';
// import CardAlert from './CardAlert';
// import OptionsMenu from './OptionsMenu';

const drawerWidth = 280;

const Drawer = styled(MuiDrawer)({
  width: drawerWidth,
  flexShrink: 0,
  boxSizing: "border-box",
  mt: 10,
  [`& .${drawerClasses.paper}`]: {
    width: drawerWidth,
    boxSizing: "border-box",
  },
});

export default function DesktopSideBar() {
  const theme = useTheme();
  const { user } = useUser();
  return (
    <Drawer
      variant="permanent"
      sx={{
        display: { xs: "none", md: "block" },
        [`& .${drawerClasses.paper}`]: {
          backgroundColor: "primary.main", // Use purple background like the first image
          overflow: "hidden",
        },
      }}
    >
      <Box
        sx={{
          display: "flex",
          gap: "var(--half-gap)",
          padding: "var(--default-padding)",
          alignItems: "center",
        }}
      >
        <Avatar
          src="/asserts/aims-logo.png"
          alt=""
          sx={{
            borderRadius: "var(--default-border-radius)",
            width: "2.5rem",
            height: "2.5rem",
          }}
        />
        <Typography variant="h3" sx={{ color: theme.palette.primary.contrastText }}>
          AIMS
        </Typography>
      </Box>
      <Box
        sx={{
          overflow: "auto",
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <SideBarContent />
      </Box>
      <Stack
        direction="row"
        sx={{
          p: 2,
          gap: 1,
          alignItems: "center",
          borderTop: "1px solid",
          borderColor: "divider",
        }}
      >
        <UserButton afterSignOutUrl="/" />
        <Box sx={{ mr: "auto" }}>
          <Typography variant="body2" sx={{ fontWeight: 500, color: theme.palette.primary.contrastText }}>
            {user?.fullName}
          </Typography>
          <Typography
            variant="body2"
            sx={{
              width: 200,
              color: theme.palette.primary.light,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {user?.emailAddresses[0]?.emailAddress}
          </Typography>
        </Box>
        {/* <OptionsMenu /> */}
      </Stack>
    </Drawer>
  );
}
