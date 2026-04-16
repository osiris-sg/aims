"use client";
import React, { useRef, useCallback } from "react";
import { Box, IconButton, Tooltip, Divider } from "@mui/material";
import {
  FormatBold,
  FormatUnderlined,
  FormatListBulleted,
} from "@mui/icons-material";

interface RichTextDescriptionProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

export default function RichTextDescription({
  value,
  onChange,
  placeholder = "Enter description",
}: RichTextDescriptionProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  const exec = useCallback((command: string, arg?: string) => {
    document.execCommand(command, false, arg);
    // After formatting, sync the HTML back
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
    editorRef.current?.focus();
  }, [onChange]);

  const handleInput = useCallback(() => {
    if (editorRef.current) {
      const html = editorRef.current.innerHTML;
      // Treat <br> only or empty tags as empty
      const isEmpty = html === "<br>" || html === "" || html === "<div><br></div>";
      onChange(isEmpty ? "" : html);
    }
  }, [onChange]);

  // Only set innerHTML when value genuinely changes from outside
  // (e.g., initial load or autocomplete selection). Avoid resetting
  // on every keystroke which would move the cursor.
  const lastExternalValue = useRef(value);
  React.useEffect(() => {
    if (editorRef.current && value !== lastExternalValue.current) {
      // Only update DOM if the editor doesn't currently have focus
      // (to avoid cursor-jump while typing).
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
      </Box>

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
          // Placeholder via CSS
          "&:empty::before": {
            content: "attr(data-placeholder)",
            color: "text.disabled",
            pointerEvents: "none",
          },
          // Style lists inside the editor
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
