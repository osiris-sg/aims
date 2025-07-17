"use client";
import React from "react";
import styles from "./layout.module.scss";
import { Box } from "@mui/material";
import DesktopSideBar from "@/components/Sidebar/DestopSideBar";
import AppNavbar from "@/components/Appnavbar";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { OrganizationProvider } from "./context/OrganizationContext";

interface Props {
  children: React.ReactNode;
}
export default function Layout(props: Props) {
  const { children } = props;
  return (
    <OrganizationProvider>
      <Box className={styles.PORTAL_LAYOUT}>
        <DesktopSideBar />
        <AppNavbar />
        <Box sx={{ flexGrow: 1, height: "100%", width: "100%", display: "flex", flexDirection: "column" }}>{children}</Box>
        <ToastContainer position="top-right" autoClose={3000} hideProgressBar={false} newestOnTop closeOnClick rtl={false} pauseOnFocusLoss draggable pauseOnHover theme="light" />
      </Box>
    </OrganizationProvider>
  );
}
