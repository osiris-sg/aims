/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import React, { useMemo } from "react";
import { useReactTable, getCoreRowModel, getPaginationRowModel, getSortedRowModel, flexRender, ExpandedState, getExpandedRowModel, SortingState, RowSelectionState } from "@tanstack/react-table";
import { Checkbox, Table as MuiTable, Skeleton, useTheme, useMediaQuery, Box } from "@mui/material";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";

interface Props {
  columns?: any[];
  data?: any[];
  subRowAccessor?: string;
  loading?: boolean;
  loadingTableRowId?: string | null;
  height?: string;
  onRowSelect?: (rows: any[]) => void;
  isNoSelectionColumn?: boolean;
}

export default function Table(props: Props) {
  const { data = [], columns = [], subRowAccessor, loading = false, loadingTableRowId = null, onRowSelect, isNoSelectionColumn = false } = props;
  const _data = useMemo(() => data, [data]);

  // Mobile responsiveness
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const [expanded, setExpanded] = React.useState<ExpandedState>(() => {
    if (!subRowAccessor) return {};

    const expandedState: ExpandedState = {};
    if (Array.isArray(_data)) {
      _data.forEach((row: any, index: number) => {
        if (row[subRowAccessor]) {
          expandedState[index] = true;
        }
      });
    }
    return expandedState;
  });
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});

  const selectionColumn = useMemo(
    () => ({
      id: "select",
      header: ({ table }: any) => <Checkbox checked={table.getIsAllRowsSelected()} onChange={table.getToggleAllRowsSelectedHandler()} sx={{ p: 0 }} />,
      cell: ({ row }: any) => {
        if (row.depth > 0) {
          return <span style={{ color: "grey" }}>└──</span>;
        }
        return <Checkbox checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} sx={{ p: 0 }} />;
      },
      size: 40,
      minSize: 40,
      maxSize: 40,
      enableSorting: false,
    }),
    []
  );
  const _columns = useMemo(() => (isNoSelectionColumn ? [...columns] : [selectionColumn, ...columns]), [columns, isNoSelectionColumn, selectionColumn]);

  const table = useReactTable({
    columns: _columns,
    data: _data,
    state: {
      expanded,
      sorting,
      rowSelection,
      pagination: { pageIndex: 0, pageSize: 30 },
    },
    onRowSelectionChange: setRowSelection,
    enableRowSelection: onRowSelect ? true : false,
    onExpandedChange: setExpanded,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getSubRows: subRowAccessor ? (row: any) => row[subRowAccessor] : undefined,
  });

  React.useEffect(() => {
    if (onRowSelect) {
      const selectedRows = table.getSelectedRowModel().rows.map((row) => row.original);
      onRowSelect(selectedRows);
    }
  }, [rowSelection, onRowSelect, table]);

  return (
    <Box
      sx={{
        width: "100%",
        overflowX: isMobile ? "auto" : "visible",
        "& .MuiTable-root": {
          minWidth: isMobile ? "600px" : "auto",
        },
      }}
    >
      <MuiTable sx={{ width: "100%", tableLayout: "auto", borderCollapse: "separate" }}>
        <TableHead sx={{ backgroundColor: "tertiary.light", position: "sticky", top: 0, zIndex: 1000 }}>
          {table.getHeaderGroups().map((headerGroup: any) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header: any) => (
                <TableCell
                  key={header.id}
                  colSpan={header.colSpan}
                  sx={{
                    padding: isMobile ? "0.3rem 0.2rem" : "0.5rem 0.5rem",
                    ...(header.id === "select"
                      ? {
                          width: "40px",
                          minWidth: "40px",
                          maxWidth: "40px",
                        }
                      : {}),
                    color: "tertiary.dark",
                    borderRight: "0.1px solid", // Add vertical divider
                    borderColor: "tertiary.main",
                    "&:last-child": {
                      borderRight: "none", // Remove border from last column
                    },
                    fontSize: isMobile ? "0.75rem" : "inherit",
                  }}
                >
                  {header.isPlaceholder ? null : (
                    <TableSortLabel active={header.column.getIsSorted() !== false} direction={header.column.getIsSorted() || undefined} onClick={header.column.getToggleSortingHandler()}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </TableSortLabel>
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableHead>
        <TableBody>
          {loading
            ? [1, 2, 3, 4].map((_item, index) => (
                <TableRow key={`loading-${index}`}>
                  {table.getHeaderGroups()[0].headers.map((header: any) => (
                    <TableCell
                      key={`loading-${header.id}`}
                      sx={{
                        padding: isMobile ? "0.3rem 0.2rem" : "0.5rem 0.3rem",
                        ...(header.id === "select"
                          ? {
                              width: "40px",
                              minWidth: "40px",
                              maxWidth: "40px",
                            }
                          : {}),
                      }}
                    >
                      <Skeleton variant="text" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : table.getRowModel().rows.map((row: any) => {
                const { id } = row.original;
                return (
                  <TableRow
                    key={row.id}
                    className={row.getIsExpanded() ? "--TABLE-EXPANDED-ROWS" : ""}
                    sx={{
                      "& > td:first-of-type": {
                        paddingLeft: row.depth ? `${row.depth * 2}rem` : undefined,
                      },
                    }}
                  >
                    {row.getVisibleCells().map((cell: any) => (
                      <TableCell
                        key={cell.id}
                        sx={{
                          padding: isMobile ? "0.3rem 0.2rem" : "0.5rem 0.3rem",
                          fontSize: isMobile ? "0.75rem" : "inherit",
                          ...(cell.column.id === "select"
                            ? {
                                width: "40px",
                                minWidth: "40px",
                                maxWidth: "40px",
                              }
                            : {
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }),
                        }}
                      >
                        {id === loadingTableRowId ? <Skeleton variant="text" sx={{ m: "0.5rem 0.3rem" }} /> : <span className="truncate">{flexRender(cell.column.columnDef.cell, cell.getContext())}</span>}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
        </TableBody>
      </MuiTable>
    </Box>
  );
}
