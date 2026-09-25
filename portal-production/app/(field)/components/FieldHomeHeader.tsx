"use client";

import React from "react";
import { Box, IconButton, Stack, Tab, Tabs, TextField, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";

/**
 * Sticky header shared by the two field home tabs (Deliveries, Maintenance):
 * title, a search field with a "+" action, and the sub-tabs. The right padding
 * on the title keeps it clear of the layout's fixed sign-out button.
 */
export function FieldHomeHeader<T extends string>({
  title,
  search,
  onSearch,
  placeholder,
  addLabel,
  onAdd,
  tabs,
  tab,
  onTab,
}: {
  title: string;
  search: string;
  onSearch: (v: string) => void;
  placeholder: string;
  addLabel: string;
  onAdd: () => void;
  tabs: { value: T; label: string }[];
  tab: T;
  onTab: (next: T) => void;
}) {
  return (
    <Box
      sx={{
        position: "sticky",
        top: 0,
        zIndex: 1,
        bgcolor: "background.default",
        px: 2,
        pt: 1.5,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Typography variant="h6" fontWeight={700} sx={{ pr: 6, mb: 1.5, lineHeight: "32px" }}>
        {title}
      </Typography>
      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          size="small"
          fullWidth
          placeholder={placeholder}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: "text.disabled" }} /> }}
        />
        <IconButton
          aria-label={addLabel}
          onClick={onAdd}
          sx={{
            flexShrink: 0,
            width: 40,
            height: 40,
            bgcolor: "primary.main",
            color: "primary.contrastText",
            "&:hover": { bgcolor: "primary.dark" },
          }}
        >
          <AddIcon />
        </IconButton>
      </Stack>
      <Tabs
        value={tab}
        onChange={(_, next: T) => onTab(next)}
        variant="fullWidth"
        sx={{ mt: 1, minHeight: 44, "& .MuiTab-root": { minHeight: 44, textTransform: "none", fontWeight: 600 } }}
      >
        {tabs.map((t) => (
          <Tab key={t.value} value={t.value} label={t.label} />
        ))}
      </Tabs>
    </Box>
  );
}
