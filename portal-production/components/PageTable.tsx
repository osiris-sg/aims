/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import React, { useEffect, useMemo, useState } from "react";
import Table from "./Table";
import { ColumnDef } from "@tanstack/react-table";
import { INVENTORY_STATUS } from "@/containers/Inventory/slice/constants";
import { useGetCategories } from "@/app/portal/hooks/api";
import { Box, Button, Typography, Pagination, Grid2, IconButton } from "@mui/material";
import { alpha } from "@mui/material/styles";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import { useForm } from "react-hook-form";
import TuneIcon from "@mui/icons-material/Tune";
import FormInputBox from "@/form-components/FormInputBox";
import SearchIcon from "@mui/icons-material/Search";
import FormSelectBox from "@/form-components/FormSelect";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import FilterDrawer, { FilterField } from "./FilterDrawer";
import { IconX } from "@tabler/icons-react";

interface Props {
  columns: ColumnDef<any>[];
  data: any[];
  tableName: string;
  subTitle: string;
  buttonName?: string;
  buttonDisabled?: boolean;
  loading: boolean;
  page?: number;
  limit?: number;
  search?: string;
  filters?: any;
  setPage?: (page: number) => void;
  setLimit?: (limit: number) => void;
  setSearch?: (search: string) => void;
  setFilters?: (filters: any) => void;
  onAddClick?: () => void;
  subRowAccessor?: string;
  filterConfig?: FilterField[];
  /**
   * Deprecated: use `filterConfig` instead. Kept for back-compat with pages that
   * haven't migrated yet. When provided without `filterConfig`, a default config
   * is built from the legacy field names (createdOn/status/category/asset).
   */
  availableFilters?: string[];
  /** Legacy: dropdown source for the asset filter when using `availableFilters`. */
  assetsData?: any[];
  pageCount?: number;
  totalDocs?: number;
  renderSubComponent?: (props: { row: any }) => React.ReactNode;
  actionButtons?: React.ReactNode[];
  headerContent?: React.ReactNode; // Custom content to display between header and table
  // Server-side sorting: pass all three to drive sort via an API call (parent
  // supplies already-sorted `data`). Omit for the default client-side sort.
  manualSorting?: boolean;
  sorting?: any;
  onSortingChange?: (updater: any) => void;
}
export default function PageTable(props: Props) {
  const { columns, data, tableName, subTitle, loading, buttonName, buttonDisabled, page, limit, search, filters, setPage, setLimit, setSearch, setFilters, pageCount, onAddClick, subRowAccessor, filterConfig: incomingFilterConfig, availableFilters, assetsData, totalDocs, renderSubComponent, actionButtons, headerContent, manualSorting, sorting, onSortingChange } = props;
  const { control, handleSubmit, watch } = useForm({ defaultValues: { limit, search } });
  const _limit = watch("limit");
  const _search = watch("search");

  useEffect(() => {
    if (setLimit && _limit && _limit !== limit) setLimit(_limit);
    if (setSearch && _search !== undefined) {
      if (_search.trim() === "") {
        setSearch("");
      } else {
        setSearch(_search);
      }
    }
    // if (setFilters && _filters && JSON.stringify(_filters) !== JSON.stringify(filters)) setFilters(_filters);
  }, [_limit, _search, filters]);

  const [openFilters, setOpenFilters] = useState(false);

  // Legacy fallback: if a caller still passes `availableFilters` (the old string-
  // array API), build a config from the same hardcoded options the old drawer
  // used. New callers should pass `filterConfig` directly.
  const { categories: legacyCategories = [] } = useGetCategories();

  const filterConfig: FilterField[] | undefined = useMemo(() => {
    if (incomingFilterConfig) return incomingFilterConfig;
    if (!availableFilters || availableFilters.length === 0) return undefined;
    const result: FilterField[] = [];
    availableFilters.forEach((key) => {
      if (key === "createdOn") result.push({ type: "dateRange", key: "createdOn", label: "Created On" });
      else if (key === "status") result.push({ type: "select", key: "status", label: "Status", options: INVENTORY_STATUS });
      else if (key === "category") result.push({ type: "select", key: "category", label: "Category", options: (legacyCategories || []).map((c: any) => ({ value: c.id, label: c.name })) });
      else if (key === "asset") result.push({ type: "select", key: "assetId", label: "Asset", options: (assetsData || []).map((a: any) => ({ value: a.id, label: a.name })) });
    });
    return result;
  }, [incomingFilterConfig, availableFilters, legacyCategories, assetsData]);

  const hasActiveFilters = (filterObj: any) => {
    if (!filterObj || !filterConfig) return false;
    return filterConfig.some((f) => {
      const v = filterObj[f.key];
      if (f.type === "dateRange") return Boolean(v?.startDate || v?.endDate);
      if (f.type === "select") return v !== undefined && v !== null && v !== "";
      return false;
    });
  };

  const onSubmit = () => {};
  return (
    <form onSubmit={handleSubmit(onSubmit)} style={{ height: "100%" }}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: "var(--double-gap)", height: "100%" }}>
        <Grid2 container spacing={2} alignItems="center">
          <Grid2 size={{ xs: 12, md: 4 }}>
            <Box>
              <Typography sx={{ fontFamily: "Manrope, Inter, sans-serif", fontSize: "1.875rem", fontWeight: 800, letterSpacing: "-0.025em", color: "text.primary", lineHeight: 1.2 }}>{tableName}</Typography>
              <Typography sx={{ fontSize: "1rem", color: "text.secondary", mt: 0.5 }}>
                {subTitle}
              </Typography>
            </Box>
          </Grid2>
          <Grid2 size={{ xs: 12, md: 8 }}>
            <Box sx={{ display: "flex", justifyContent: "flex-end", gap: "var(--half-gap)" }}>
              {buttonName && (
                <Button variant="contained" color="primary" startIcon={<AddCircleOutlineIcon />} onClick={onAddClick} disabled={buttonDisabled}>
                  {buttonName}
                </Button>
              )}

              {actionButtons && actionButtons.map((btn, idx) => <React.Fragment key={idx}>{btn}</React.Fragment>)}

              {filters && filterConfig && filterConfig.length > 0 && (
                <Button variant="outlined" color="primary" onClick={() => setOpenFilters(true)} sx={{ display: "flex", p: 0, minWidth: "100px" }}>
                  {hasActiveFilters(filters) ? (
                    <Box sx={{ display: "flex", alignItems: "center", p: 1, gap: 0.25 }}>
                      <IconX />
                      Filters Applied
                    </Box>
                  ) : (
                    <Box sx={{ display: "flex", alignItems: "center", p: 1, gap: 0.25 }}>
                      <TuneIcon />
                      Filter
                    </Box>
                  )}
                </Button>
              )}
              <FormInputBox fullWidth startIcon={<SearchIcon />} control={control} name="search" placeHolder="Search" />
              <IconButton>
                <NotificationsNoneIcon />
              </IconButton>
            </Box>
          </Grid2>
        </Grid2>

        {/* Custom header content */}
        {headerContent && (
          <Box sx={{ width: "100%" }}>
            {headerContent}
          </Box>
        )}

        <Box
          sx={(t) => ({
            // Scroll the table internally on BOTH axes when content exceeds the
            // box. (Was `overflow: "hidden"`, which overrode overflowX and clipped
            // rows beyond the visible height — no vertical scrollbar.) `minHeight:
            // 0` lets this flex child shrink below its content so the inner scroll
            // actually engages inside a bounded (flex: 1 / height: 100%) layout.
            overflowX: "auto",
            overflowY: "auto",
            minHeight: 0,
            width: "100%",
            backgroundColor: "background.paper",
            padding: 0,
            borderRadius: "8px",
            // Solid visible outline — the header band is the same grey as the
            // page background, so a near-transparent border made the table's
            // top edge disappear into the page. CSS var flips for dark mode.
            border: "1px solid var(--table-grid)",
            flex: 1,
          })}
        >
          <Table columns={columns} data={data} onRowSelect={() => {}} loading={loading} subRowAccessor={subRowAccessor} manualSorting={manualSorting} sorting={sorting} onSortingChange={onSortingChange} />
        </Box>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", overflowX: "hidden" }}>
          <Box sx={{ display: "flex", gap: "var(--default-gap)", alignItems: "center" }}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Showing
            </Typography>
            <FormSelectBox size="small" control={control} name="limit" menuItems={[10, 20, 50, 100].map((num) => ({ label: String(num), value: num }))} menuTitle="Page Size" />
          </Box>
          {totalDocs !== undefined && limit !== undefined && page !== undefined && (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {`Showing ${(page - 1) * limit + 1}-${Math.min(page * limit, totalDocs)} out of ${totalDocs} records`}
            </Typography>
          )}
          <Pagination page={page ?? 1} count={pageCount ?? 1} siblingCount={0} boundaryCount={0} onChange={(event, value) => setPage && setPage(value)} />
        </Box>
        {filters && setFilters && filterConfig && (
          <FilterDrawer
            openFilterDrawerStatus={openFilters}
            onClose={() => setOpenFilters(false)}
            onSetFilters={(filters) => setFilters(filters)}
            defaultFilters={filters}
            filterConfig={filterConfig}
          />
        )}
      </Box>
    </form>
  );
}
