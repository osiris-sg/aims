"use client";
import React, { useRef, useCallback, useState } from "react";
import {
  Box,
  IconButton,
  Tooltip,
  Divider,
  Menu,
  MenuItem,
  CircularProgress,
  Typography,
} from "@mui/material";
import {
  FormatBold,
  FormatUnderlined,
  FormatListBulleted,
  History as HistoryIcon,
} from "@mui/icons-material";

interface RichTextDescriptionProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  pastDescriptions?: string[];
  loadingDescriptions?: boolean;
}

export default function RichTextDescription({
  value,
  onChange,
  placeholder = "Enter description",
  pastDescriptions = [],
  loadingDescriptions = false,
}: RichTextDescriptionProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [historyAnchor, setHistoryAnchor] = useState<null | HTMLElement>(null);

  const exec = useCallback((command: string, arg?: string) => {
    document.execCommand(command, false, arg);
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
    editorRef.current?.focus();
  }, [onChange]);

  const handleInput = useCallback(() => {
    if (editorRef.current) {
      const html = editorRef.current.innerHTML;
      const isEmpty = html === "<br>" || html === "" || html === "<div><br></div>";
      onChange(isEmpty ? "" : html);
    }
  }, [onChange]);

  const handleSelectPast = (desc: string) => {
    if (editorRef.current) {
      editorRef.current.innerHTML = desc;
    }
    onChange(desc);
    setHistoryAnchor(null);
  };

  // Only set innerHTML when value genuinely changes from outside
  const lastExternalValue = useRef(value);
  React.useEffect(() => {
    if (editorRef.current && value !== lastExternalValue.current) {
      if (document.activeElement !== editorRef.current) {
        editorRef.current.innerHTML = value || "";
      }
      lastExternalValue.current = value;
    }
  }, [value]);

  // Set initial content
  React.useEffect(() => {
    if (editorRef.current && value) {
      editorRef.current.innerHTML = value;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: "0.5rem",
        overflow: "hidden",
        "&:focus-within": {
          borderColor: "primary.main",
        },
      }}
    >
      {/* Toolbar */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.25,
          px: 0.5,
          py: 0.25,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "action.hover",
        }}
      >
        <Tooltip title="Bold (Ctrl+B)">
          <IconButton size="small" onMouseDown={(e) => { e.preventDefault(); exec("bold"); }}>
            <FormatBold sx={{ fontSize: "1rem" }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Underline (Ctrl+U)">
          <IconButton size="small" onMouseDown={(e) => { e.preventDefault(); exec("underline"); }}>
            <FormatUnderlined sx={{ fontSize: "1rem" }} />
          </IconButton>
        </Tooltip>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />
        <Tooltip title="Bullet List">
          <IconButton size="small" onMouseDown={(e) => { e.preventDefault(); exec("insertUnorderedList"); }}>
            <FormatListBulleted sx={{ fontSize: "1rem" }} />
          </IconButton>
        </Tooltip>
        {pastDescriptions.length > 0 && (
          <>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />
            <Tooltip title="Past descriptions">
              <IconButton
                size="small"
                onClick={(e) => setHistoryAnchor(e.currentTarget)}
              >
                {loadingDescriptions ? (
                  <CircularProgress size={14} />
                ) : (
                  <HistoryIcon sx={{ fontSize: "1rem" }} />
                )}
              </IconButton>
            </Tooltip>
          </>
        )}
      </Box>

      {/* Past descriptions menu */}
      <Menu
        anchorEl={historyAnchor}
        open={Boolean(historyAnchor)}
        onClose={() => setHistoryAnchor(null)}
        slotProps={{
          paper: {
            sx: { maxHeight: 280, maxWidth: 400, overflow: "auto" },
          },
        }}
      >
        <Typography sx={{ px: 2, py: 0.5, fontSize: "0.65rem", color: "text.secondary", fontWeight: 600 }}>
          Past Descriptions
        </Typography>
        {pastDescriptions.map((desc, idx) => (
          <MenuItem
            key={idx}
            onClick={() => handleSelectPast(desc)}
            sx={{
              fontSize: "0.7rem",
              whiteSpace: "normal",
              maxWidth: 380,
              lineHeight: 1.4,
              py: 0.75,
            }}
          >
            {desc.length > 120 ? desc.slice(0, 120) + "…" : desc}
          </MenuItem>
        ))}
      </Menu>

      {/* Editable area */}
      <Box
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        data-placeholder={placeholder}
        sx={{
          minHeight: 60,
          maxHeight: 300,
          overflowY: "auto",
          px: 1,
          py: 0.75,
          fontSize: "0.75rem",
          lineHeight: 1.6,
          fontWeight: 400,
          outline: "none",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          "&:empty::before": {
            content: "attr(data-placeholder)",
            color: "text.disabled",
            pointerEvents: "none",
          },
          "& ul": {
            pl: 2,
            m: 0,
            listStyleType: "disc",
          },
          "& li": {
            fontSize: "0.75rem",
            lineHeight: 1.6,
          },
        }}
      />
    </Box>
  );
}
