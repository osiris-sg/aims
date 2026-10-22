"use client";

import React from "react";
import { Box, Button, IconButton, Stack, Tab, Tabs, TextField } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";
import { FIELD_APP_BAR_OFFSET, useFieldAppBar } from "./FieldAppBar";

/**
 * Sticky header shared by the two field home tabs (Deliveries, Maintenance):
 * a search field with a "+" action, and the sub-tabs. The title rides in the
 * app bar next to the wordmark; this block sticks right under that bar.
 *
 * `addButtonLabel` (2026-10-22) turns the "+" into a labelled button in the
 * same slot (Deliveries shows "Ad-hoc"); without it the icon stays.
 */
export function FieldHomeHeader<T extends string>({
  title,
  search,
  onSearch,
  placeholder,
  addLabel,
  addButtonLabel,
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
  /** Visible text for the action; when set, a labelled button replaces the "+". */
  addButtonLabel?: string;
  onAdd: () => void;
  tabs: { value: T; label: string }[];
  tab: T;
  onTab: (next: T) => void;
}) {
  useFieldAppBar({ section: title });
  return (
    <Box
      sx={{
        position: "sticky",
        top: FIELD_APP_BAR_OFFSET,
        zIndex: 1,
        bgcolor: "background.paper",
        px: 2,
        pt: 1.5,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          size="small"
          fullWidth
          placeholder={placeholder}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          sx={{ "& .MuiInputBase-root": { minHeight: 44, bgcolor: "background.default" } }}
          InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: "text.disabled" }} /> }}
        />
        {addButtonLabel ? (
          <Button
            aria-label={addLabel}
            onClick={onAdd}
            variant="contained"
            disableElevation
            startIcon={<AddIcon />}
            sx={{ flexShrink: 0, minHeight: 44, height: 44, borderRadius: "12px", px: 1.75, fontWeight: 700, whiteSpace: "nowrap" }}
          >
            {addButtonLabel}
          </Button>
        ) : (
          <IconButton
            aria-label={addLabel}
            onClick={onAdd}
            sx={{
              flexShrink: 0,
              width: 44,
              height: 44,
              borderRadius: "12px",
              bgcolor: "primary.main",
              color: "primary.contrastText",
              "&:hover": { bgcolor: "primary.dark" },
            }}
          >
            <AddIcon />
          </IconButton>
        )}
      </Stack>
      <Tabs
        value={tab}
        onChange={(_, next: T) => onTab(next)}
        variant="fullWidth"
        sx={{ mt: 0.5, minHeight: 48, "& .MuiTab-root": { minHeight: 48, textTransform: "none", fontWeight: 600 } }}
      >
        {tabs.map((t) => (
          <Tab key={t.value} value={t.value} label={t.label} />
        ))}
      </Tabs>
    </Box>
  );
}
