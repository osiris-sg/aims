"use client";
import React, { useRef, useCallback, useState, useEffect } from "react";
import {
  Box,
  IconButton,
  Tooltip,
  Divider,
  Paper,
  MenuItem,
  Typography,
  ClickAwayListener,
} from "@mui/material";
import {
  FormatBold,
  FormatUnderlined,
  FormatListBulleted,
  Close as CloseIcon,
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
}: RichTextDescriptionProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[]>([]);

  const exec = useCallback((command: string, arg?: string) => {
    document.execCommand(command, false, arg);
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
    editorRef.current?.focus();
  }, [onChange]);

  const filterSuggestions = useCallback((text: string) => {
    if (pastDescriptions.length === 0) return;
    const query = text.trim().toLowerCase();
    if (query.length === 0) {
      // Show all when empty
      setFilteredSuggestions(pastDescriptions.slice(0, 10));
      setShowSuggestions(pastDescriptions.length > 0);
    } else {
      const matches = pastDescriptions.filter(
        (d) => d.toLowerCase().includes(query)
      ).slice(0, 10);
      setFilteredSuggestions(matches);
      setShowSuggestions(matches.length > 0);
    }
  }, [pastDescriptions]);

  const handleInput = useCallback(() => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    const isEmpty = html === "<br>" || html === "" || html === "<div><br></div>";
    onChange(isEmpty ? "" : html);

    const plainText = editorRef.current.textContent || "";
    filterSuggestions(plainText);
  }, [onChange, filterSuggestions]);

  const handleSelectSuggestion = (desc: string) => {
    if (editorRef.current) {
      editorRef.current.innerHTML = desc;
    }
    onChange(desc);
    setShowSuggestions(false);
    editorRef.current?.focus();
  };

  const handleFocus = () => {
    const plainText = editorRef.current?.textContent || "";
    filterSuggestions(plainText);
  };

  // Only set innerHTML when value genuinely changes from outside
  const lastExternalValue = useRef(value);
  useEffect(() => {
    if (editorRef.current && value !== lastExternalValue.current) {
      if (document.activeElement !== editorRef.current) {
        editorRef.current.innerHTML = value || "";
      }
      lastExternalValue.current = value;
    }
  }, [value]);

  // Set initial content
  useEffect(() => {
    if (editorRef.current && value) {
      editorRef.current.innerHTML = value;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ClickAwayListener onClickAway={() => setShowSuggestions(false)}>
      <Box ref={containerRef} sx={{ position: "relative" }}>
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
            onFocus={handleFocus}
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
              "& ul": { pl: 2, m: 0, listStyleType: "disc" },
              "& li": { fontSize: "0.75rem", lineHeight: 1.6 },
            }}
          />
        </Box>

        {/* Autocomplete-style suggestions dropdown */}
        {showSuggestions && filteredSuggestions.length > 0 && (
          <Paper
            elevation={4}
            sx={{
              position: "absolute",
              left: 0,
              right: 0,
              top: "100%",
              zIndex: 1300,
              maxHeight: 220,
              overflowY: "auto",
              mt: 0.5,
              borderRadius: "0.5rem",
            }}
          >
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", px: 1.5, pt: 0.75, pb: 0.25 }}>
              <Typography sx={{ fontSize: "0.6rem", color: "text.secondary", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Past descriptions
              </Typography>
              <IconButton size="small" onClick={() => setShowSuggestions(false)} sx={{ p: 0.25 }}>
                <CloseIcon sx={{ fontSize: "0.85rem" }} />
              </IconButton>
            </Box>
            {filteredSuggestions.map((desc, idx) => (
              <MenuItem
                key={idx}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelectSuggestion(desc);
                }}
                sx={{
                  fontSize: "0.7rem",
                  whiteSpace: "normal",
                  lineHeight: 1.4,
                  py: 0.75,
                  px: 1.5,
                }}
              >
                {desc.length > 150 ? desc.slice(0, 150) + "…" : desc}
              </MenuItem>
            ))}
          </Paper>
        )}
      </Box>
    </ClickAwayListener>
  );
}
