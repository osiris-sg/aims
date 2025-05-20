"use client";
import React from "react";
import styles from "./layout.module.scss";
import { Box } from "@mui/material";
import DesktopSideBar from "@/components/Sidebar/DestopSideBar";
import AppNavbar from "@/components/Appnavbar";

interface Props {
  children: React.ReactNode;
}
export default function Layout(props: Props) {
  const { children } = props;
  return (
    <Box className={styles.PORTAL_LAYOUT}>
      <DesktopSideBar />
      <AppNavbar />
      {children}
    </Box>
  );
}
