import * as React from "react";
import { styled } from "@mui/material/styles";
import AppBar from "@mui/material/AppBar";
import Stack from "@mui/material/Stack";
import MuiToolbar from "@mui/material/Toolbar";
import { tabsClasses } from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import { Avatar, IconButton } from "@mui/material";
import MobileSideBar from "./Sidebar/MobileSidebar";

const Toolbar = styled(MuiToolbar)({
  width: "100%",
  padding: "12px",
  display: "flex",
  flexDirection: "column",
  alignItems: "start",
  justifyContent: "center",
  gap: "12px",
  flexShrink: 0,
  [`& ${tabsClasses.flexContainer}`]: {
    gap: "8px",
    p: "8px",
    pb: 0,
  },
});

export default function AppNavbar() {
  const [open, setOpen] = React.useState(false);
  const toggleDrawer = (newOpen: boolean) => {
    setOpen(newOpen);
  };

  return (
    <AppBar
      position="fixed"
      sx={{
        display: { xs: "auto", md: "none" },
        boxShadow: 0,
        bgcolor: "primary.main", // Use purple background like the sidebar
        backgroundImage: "none",
        borderBottom: "1px solid",
        borderColor: "divider",
        top: "var(--template-frame-height, 0px)",
      }}
    >
      <Toolbar variant="regular">
        <Stack
          direction="row"
          sx={{
            alignItems: "center",
            flexGrow: 1,
            width: "100%",
            gap: 1,
          }}
        >
          <Stack direction="row" spacing={1} sx={{ justifyContent: "center", mr: "auto", alignItems: "center" }}>
            <Avatar
              src="/asserts/aims-logo.png"
              alt=""
              sx={{
                borderRadius: "var(--default-border-radius)",
                width: "2.5rem",
                height: "2.5rem",
              }}
            />
            <Typography variant="h4" component="h1" sx={{ color: "white" }}>
              AIMS
            </Typography>
          </Stack>
          <IconButton aria-label="menu" onClick={() => toggleDrawer(true)}>
            <MenuRoundedIcon sx={{ color: "white" }} />
          </IconButton>
          <MobileSideBar open={open} toggleDrawer={(state) => toggleDrawer(state)} />
        </Stack>
      </Toolbar>
    </AppBar>
  );
}
