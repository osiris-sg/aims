import { Box, IconButton } from "@mui/material";
import React from "react";
import { IconLayoutSidebarLeftExpand, IconLayoutSidebarLeftCollapse } from "@tabler/icons-react";

interface Props {
  children: React.ReactNode;
  isToolBarOpen?: boolean;
  toggleToolbar?: () => void;
  documentEditMode?: boolean;
}
export default function TemplatePaper(props: Props) {
  const { children, isToolBarOpen = false, toggleToolbar = () => {}, documentEditMode = false } = props;

  return (
    <Box sx={{ display: "flex", width: "100%", height: "100%", overflow: "hidden" }}>
      <Box sx={{ width: "100%", position: "relative", backgroundColor: "tertiary.contrastText", borderRadius: "var(--default-border-radius)", alignItems: "center", padding: "var(--default-padding)", paddingBottom: "5rem", overflow: "auto" }}>
        {!documentEditMode && (
          <IconButton sx={{ position: "fixed" }} onClick={() => toggleToolbar()}>
            {!isToolBarOpen ? <IconLayoutSidebarLeftExpand /> : <IconLayoutSidebarLeftCollapse />}
          </IconButton>
        )}
        <Box sx={{ width: "894px", minHeight: "1123px", backgroundColor: "white", border: "1px solid", borderColor: "tertiary.main", margin: "auto" }}>{children}</Box>
      </Box>
    </Box>
  );
}
