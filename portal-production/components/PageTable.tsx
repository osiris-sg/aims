/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import React, { useEffect, useState } from "react";
import Table from "./Table";
import { ColumnDef } from "@tanstack/react-table";
import { Box, Button, Typography, Pagination, Grid2, IconButton } from "@mui/material";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import { useForm } from "react-hook-form";
import TuneIcon from "@mui/icons-material/Tune";
import FormInputBox from "@/form-components/FormInputBox";
import SearchIcon from "@mui/icons-material/Search";
import FormSelectBox from "@/form-components/FormSelect";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import FilterDrawer from "./FilterDrawer";
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
  availableFilters?: string[];
  pageCount?: number;
  totalDocs?: number;
  renderSubComponent?: (props: { row: any }) => React.ReactNode;
  actionButtons?: React.ReactNode[];
  assetsData?: any[]; // Add assets data prop
  headerContent?: React.ReactNode; // Custom content to display between header and table
}
export default function PageTable(props: Props) {
  const { columns, data, tableName, subTitle, loading, buttonName, buttonDisabled, page, limit, search, filters, setPage, setLimit, setSearch, setFilters, pageCount, onAddClick, subRowAccessor, availableFilters, totalDocs, renderSubComponent, actionButtons, assetsData, headerContent } = props;
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

  const hasActiveFilters = (filterObj: any) => {
    // Check if createdOn has non-null dates
    if (filterObj.createdOn?.startDate || filterObj.createdOn?.endDate) {
      return true;
    }

    // Check if status is not empty
    if (filterObj.status && filterObj.status !== "") {
      return true;
    }

    // Check if category is not empty
    if (filterObj.category && filterObj.category !== "") {
      return true;
    }

    // Check if assetId is not empty
    if (filterObj.assetId && filterObj.assetId !== "") {
      return true;
    }

    // No active filters found
    return false;
  };

  const onSubmit = () => {};
  return (
    <form onSubmit={handleSubmit(onSubmit)} style={{ height: "100%" }}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: "var(--double-gap)", height: "100%" }}>
        <Grid2 container spacing={2}>
          <Grid2 size={{ xs: 12, md: 4 }}>
            <Box>
              <Typography variant="h4">{tableName}</Typography>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
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

              {filters && (
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

        <Box sx={{ overflowX: "auto", width: "100%", border: "1px solid", borderColor: "tertiary.main", padding: "var(--default-padding)", borderRadius: "var(--default-border-radius)", flex: 1 }}>
          <Table columns={columns} data={data} onRowSelect={() => {}} loading={loading} subRowAccessor={subRowAccessor} />
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
        {filters && setFilters && <FilterDrawer openFilterDrawerStatus={openFilters} onClose={() => setOpenFilters(false)} onSetFilters={(filters) => setFilters(filters)} defaultFilters={filters} availableFilterTypes={availableFilters} assetsData={assetsData} />}
      </Box>
    </form>
  );
}
