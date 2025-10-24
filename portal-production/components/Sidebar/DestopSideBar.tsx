"use client";
import * as React from "react";
import { styled, useTheme } from "@mui/material/styles";
import Avatar from "@mui/material/Avatar";
import MuiDrawer, { drawerClasses } from "@mui/material/Drawer";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import DynamicSidebarContent from "./DynamicSidebarContent";
// Fallback to static sidebar if needed
// import SideBarContent from "./SideBarContent";
import { UserButton, useUser } from "@clerk/nextjs";
import { useSidebar } from "./SidebarContext";
import MenuIcon from "@mui/icons-material/Menu";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";
// import SelectContent from './SelectContent';
// import MenuContent from './MenuContent';
// import CardAlert from './CardAlert';
// import OptionsMenu from './OptionsMenu';

const drawerWidth = 280;
const collapsedDrawerWidth = 64;

const Drawer = styled(MuiDrawer)<{ collapsed: boolean }>(({ collapsed }) => ({
  width: collapsed ? collapsedDrawerWidth : drawerWidth,
  flexShrink: 0,
  boxSizing: "border-box",
  transition: "width 0.3s ease",
  [`& .${drawerClasses.paper}`]: {
    width: collapsed ? collapsedDrawerWidth : drawerWidth,
    boxSizing: "border-box",
    transition: "width 0.3s ease",
    overflow: "hidden",
  },
}));

export default function DesktopSideBar() {
  const theme = useTheme();
  const { user } = useUser();
  const { isCollapsed, toggleSidebar } = useSidebar();

  return (
    <Drawer
      collapsed={isCollapsed}
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
          padding: isCollapsed ? "16px 8px" : "var(--default-padding)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {isCollapsed ? (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
            <Avatar
              src="/asserts/aims-logo.png"
              alt=""
              sx={{
                borderRadius: "var(--default-border-radius)",
                width: "2rem",
                height: "2rem",
              }}
            />
            <Tooltip title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
              <IconButton
                onClick={toggleSidebar}
                size="small"
                sx={{
                  color: theme.palette.primary.contrastText,
                  "&:hover": {
                    backgroundColor: "rgba(255, 255, 255, 0.1)",
                  },
                }}
              >
                <MenuIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        ) : (
          <>
            <Box sx={{ display: "flex", alignItems: "center", gap: "var(--half-gap)" }}>
              <Avatar
                src="/asserts/aims-logo.png"
                alt=""
                sx={{
                  borderRadius: "var(--default-border-radius)",
                  width: "1.75rem",
                  height: "1.75rem",
                }}
              />
              <Typography variant="h5" sx={{ color: theme.palette.primary.contrastText }}>
                AIMS
              </Typography>
            </Box>
            <Tooltip title="Collapse sidebar">
              <IconButton
                onClick={toggleSidebar}
                sx={{
                  color: theme.palette.primary.contrastText,
                  "&:hover": {
                    backgroundColor: "rgba(255, 255, 255, 0.1)",
                  },
                }}
              >
                <MenuOpenIcon />
              </IconButton>
            </Tooltip>
          </>
        )}
      </Box>
      <Box
        sx={{
          overflow: "auto",
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <DynamicSidebarContent />
      </Box>
      <Stack
        direction="row"
        sx={{
          p: 2,
          gap: 1,
          alignItems: "center",
          borderTop: "1px solid",
          borderColor: "divider",
          justifyContent: isCollapsed ? "center" : "flex-start",
        }}
      >
        <UserButton afterSignOutUrl="/" />
        {!isCollapsed && (
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
        )}
        {/* <OptionsMenu /> */}
      </Stack>
    </Drawer>
  );
}
