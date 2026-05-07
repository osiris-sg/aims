"use client";
import * as React from "react";
import { styled, alpha } from "@mui/material/styles";
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
import { useThemeMode } from "@/contexts/ThemeModeContext";
import MenuIcon from "@mui/icons-material/Menu";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
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
  const { user } = useUser();
  const { isCollapsed, toggleSidebar } = useSidebar();
  const { mode, toggleMode } = useThemeMode();

  return (
    <Drawer
      collapsed={isCollapsed}
      variant="permanent"
      sx={{
        display: { xs: "none", md: "block" },
        [`& .${drawerClasses.paper}`]: {
          backgroundColor: "#041627",
          color: "#FFFFFF",
          overflow: "hidden",
          borderRight: "none",
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
                backgroundColor: "transparent",
              }}
            />
            <Tooltip title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
              <IconButton
                onClick={toggleSidebar}
                size="small"
                sx={{
                  color: "#FFFFFF",
                  "&:hover": {
                    backgroundColor: "rgba(255, 255, 255, 0.08)",
                  },
                }}
              >
                <MenuIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        ) : (
          <>
            <Box sx={{ display: "flex", alignItems: "center", gap: "var(--half-gap)", flexDirection: "column", alignSelf: "flex-start" }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: "var(--half-gap)" }}>
                <Avatar
                  src="/asserts/aims-logo.png"
                  alt=""
                  sx={{
                    borderRadius: "var(--default-border-radius)",
                    width: "1.75rem",
                    height: "1.75rem",
                    backgroundColor: "transparent",
                  }}
                />
                <Typography
                  sx={{
                    color: "#FFFFFF",
                    fontFamily: 'Manrope, Inter, sans-serif',
                    fontWeight: 800,
                    fontSize: "1.125rem",
                    letterSpacing: "-0.01em",
                  }}
                >
                  AIMS
                </Typography>
              </Box>
              <Typography
                sx={{
                  color: "rgba(255, 255, 255, 0.6)",
                  fontSize: "0.75rem",
                  fontWeight: 500,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  pl: "2.25rem",
                  mt: "-0.25rem",
                }}
              >
                Inventory Architect
              </Typography>
            </Box>
            <Tooltip title="Collapse sidebar">
              <IconButton
                onClick={toggleSidebar}
                sx={{
                  color: "#FFFFFF",
                  ml: "auto",
                  "&:hover": {
                    backgroundColor: "rgba(255, 255, 255, 0.08)",
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
          backgroundColor: "rgba(255, 255, 255, 0.04)",
          justifyContent: isCollapsed ? "center" : "flex-start",
        }}
      >
        <UserButton afterSignOutUrl="/" />
        {!isCollapsed && (
          <Box sx={{ mr: "auto", overflow: "hidden" }}>
            <Typography variant="body2" sx={{ fontWeight: 700, color: "#FFFFFF", fontSize: "0.75rem", lineHeight: 1.2 }} className="truncate">
              {user?.fullName}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                width: 180,
                color: "rgba(255, 255, 255, 0.6)",
                fontSize: "0.625rem",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {user?.emailAddresses[0]?.emailAddress}
            </Typography>
          </Box>
        )}
        <Tooltip title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
          <IconButton
            onClick={toggleMode}
            size="small"
            sx={{
              color: "#FFFFFF",
              "&:hover": {
                backgroundColor: "rgba(255, 255, 255, 0.08)",
              },
            }}
          >
            {mode === "dark" ? <LightModeOutlinedIcon fontSize="small" /> : <DarkModeOutlinedIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Stack>
    </Drawer>
  );
}
