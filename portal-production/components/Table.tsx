/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import React, { useMemo } from "react";
import { useReactTable, getCoreRowModel, getPaginationRowModel, getSortedRowModel, flexRender, ExpandedState, getExpandedRowModel, SortingState, RowSelectionState } from "@tanstack/react-table";
import { Checkbox, Table as MuiTable, Skeleton, useTheme, useMediaQuery, Box } from "@mui/material";
import { alpha } from "@mui/material/styles";
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
  // Controlled / server-side sorting. When manualSorting is true, the table does
  // NOT sort rows itself — the parent provides already-sorted `data` and drives
  // the sort via `sorting` + `onSortingChange` (typically feeding an API call).
  // Omit all three for the default internal client-side sorting (unchanged).
  manualSorting?: boolean;
  sorting?: SortingState;
  onSortingChange?: (updater: any) => void;
}

export default function Table(props: Props) {
  const { data = [], columns = [], subRowAccessor, loading = false, loadingTableRowId = null, onRowSelect, isNoSelectionColumn = false, manualSorting = false, sorting: controlledSorting, onSortingChange: controlledOnSortingChange } = props;
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

  // Control pagination locally to avoid infinite resets from react-table
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 30 });

  // When the parent drives sorting/pagination server-side (manualSorting), it
  // passes exactly one page of rows — render all of them instead of re-paginating
  // at 30 (which would re-cap a limit of 50/100). Client-side mode keeps pageSize 30.
  React.useEffect(() => {
    if (manualSorting) {
      setPagination((p) => ({ ...p, pageIndex: 0, pageSize: Math.max(_data.length, 1) }));
    }
  }, [manualSorting, _data.length]);

  const table = useReactTable({
    columns: _columns,
    data: _data,
    state: {
      expanded,
      sorting: controlledSorting ?? sorting,
      rowSelection,
      pagination,
    },
    manualSorting,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: setPagination,
    enableRowSelection: onRowSelect ? true : false,
    onExpandedChange: setExpanded,
    onSortingChange: controlledOnSortingChange ?? setSorting,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getSubRows: subRowAccessor ? (row: any) => row[subRowAccessor] : undefined,
    // Prevent automatic resets that can cause cascading setState loops when data/columns identities change
    autoResetPageIndex: false,
    autoResetExpanded: false,
    // @ts-expect-error - available in our tanstack version; ignore type gap
    autoResetRowSelection: false,
    autoResetSorting: false,
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
        maxWidth: "100%",
        // Never CLIP content — if columns genuinely can't fit, scroll
        // horizontally instead of silently cutting off the action icons.
        overflowX: "auto",
        "& .MuiTable-root": {
          width: "100%",
          maxWidth: "100%",
        },
      }}
    >
      <MuiTable sx={{ width: "100%", maxWidth: "100%", tableLayout: "fixed", borderCollapse: "separate" }}>
        <TableHead sx={{ backgroundColor: "surfaceTones.low", position: "sticky", top: 0, zIndex: 1000 }}>
          {table.getHeaderGroups().map((headerGroup: any) => (
            <TableRow key={headerGroup.id} sx={{ "&:hover": { backgroundColor: "surfaceTones.low" } }}>
              {headerGroup.headers.map((header: any) => (
                <TableCell
                  key={header.id}
                  colSpan={header.colSpan}
                  sx={(t) => ({
                    padding: isMobile ? "8px 10px" : "10px 16px",
                    ...(header.id === "select"
                      ? {
                          width: "40px",
                          minWidth: "40px",
                          maxWidth: "40px",
                        }
                      : header.column.columnDef.pxWidth
                      ? {
                          // Fixed pixel width — icon/action columns reserve
                          // exactly the space their content needs so the icons
                          // can never be squeezed out and clipped.
                          width: `${header.column.columnDef.pxWidth}px`,
                          minWidth: `${header.column.columnDef.pxWidth}px`,
                          maxWidth: `${header.column.columnDef.pxWidth}px`,
                        }
                      : header.column.columnDef.size
                      ? {
                          width: `${header.column.columnDef.size}%`,
                          minWidth: header.column.columnDef.minSize ? `${header.column.columnDef.minSize}%` : `${header.column.columnDef.size}%`,
                          maxWidth: header.column.columnDef.maxSize ? `${header.column.columnDef.maxSize}%` : undefined,
                        }
                      : {}),
                    color: "text.secondary",
                    borderRight: "none",
                    borderBottom: `1px solid ${alpha(t.palette.outlineVariant, 0.15)}`,
                    fontSize: "0.625rem",
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    // Header follows its column's alignment (align: "right" for
                    // money columns, "center" for icon/action columns).
                    textAlign: header.column.columnDef.align || "left",
                  })}
                >
                  {header.isPlaceholder ? null : header.column.getCanSort() ? (
                    // Sortable (data) column — always show the ↕ arrow (dimmed
                    // until active) so users can see the column is sortable.
                    <TableSortLabel
                      active={header.column.getIsSorted() !== false}
                      direction={header.column.getIsSorted() || "asc"}
                      onClick={header.column.getToggleSortingHandler()}
                      sx={{
                        "& .MuiTableSortLabel-icon": {
                          opacity: header.column.getIsSorted() ? 1 : 0.4,
                        },
                      }}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </TableSortLabel>
                  ) : (
                    // Non-sortable (Action / select / icon) column — plain label.
                    flexRender(header.column.columnDef.header, header.getContext())
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
                        padding: isMobile ? "8px 10px" : "8px 16px",
                        ...(header.id === "select"
                          ? {
                              width: "40px",
                              minWidth: "40px",
                              maxWidth: "40px",
                            }
                          : header.column.columnDef.size
                          ? {
                              width: `${header.column.columnDef.size}%`,
                              minWidth: header.column.columnDef.minSize ? `${header.column.columnDef.minSize}%` : `${header.column.columnDef.size}%`,
                              maxWidth: header.column.columnDef.maxSize ? `${header.column.columnDef.maxSize}%` : undefined,
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
                      // Allow rows to expand vertically based on content
                      height: "auto",
                      minHeight: "40px",
                    }}
                  >
                    {row.getVisibleCells().map((cell: any) => {
                      // Cells WRAP by default — long values grow the row
                      // instead of silently truncating ("Qingjian Intern…").
                      // Structured columns (dates, amounts, status, actions)
                      // opt out with `nowrap: true` on the column def to stay
                      // on one line. (`wrap: true` kept for back-compat.)
                      const wrap = cell.column.columnDef.nowrap !== true;
                      const isDescription = cell.column.id === "description";
                      return (
                      <TableCell
                        key={cell.id}
                        sx={{
                          padding: isMobile ? "8px 10px" : "8px 16px",
                          fontSize: isMobile ? "0.8125rem" : "0.875rem",
                          textAlign: cell.column.columnDef.align || "left",
                          ...(cell.column.id === "select"
                            ? {
                                width: "40px",
                                minWidth: "40px",
                                maxWidth: "40px",
                              }
                            : cell.column.columnDef.pxWidth
                            ? {
                                width: `${cell.column.columnDef.pxWidth}px`,
                                minWidth: `${cell.column.columnDef.pxWidth}px`,
                                maxWidth: `${cell.column.columnDef.pxWidth}px`,
                                overflow: "visible",
                              }
                            : cell.column.columnDef.size
                            ? {
                                width: `${cell.column.columnDef.size}%`,
                                minWidth: cell.column.columnDef.minSize ? `${cell.column.columnDef.minSize}%` : `${cell.column.columnDef.size}%`,
                                maxWidth: cell.column.columnDef.maxSize ? `${cell.column.columnDef.maxSize}%` : undefined,
                                // Allow description / wrap columns to grow vertically.
                                ...(isDescription || wrap
                                  ? {
                                      whiteSpace: "normal",
                                      wordBreak: "break-word",
                                      overflow: "visible",
                                      verticalAlign: "middle",
                                      height: "auto",
                                      minHeight: "auto",
                                      boxSizing: "border-box",
                                    }
                                  : {
                                      overflow: "hidden",
                                    }),
                              }
                            : wrap
                            ? {
                                whiteSpace: "normal",
                                wordBreak: "break-word",
                                overflow: "visible",
                                verticalAlign: "middle",
                              }
                            : {
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }),
                        }}
                      >
                        {id === loadingTableRowId ? (
                          <Skeleton variant="text" sx={{ m: "0.5rem 0.3rem" }} />
                        ) : (
                          <div
                            className={isDescription || wrap ? "" : "truncate"}
                            style={{
                              ...(isDescription
                                ? {
                                    height: "auto",
                                    minHeight: "auto",
                                    display: "flex",
                                    alignItems: "flex-start",
                                    width: "100%",
                                    maxWidth: "100%",
                                    boxSizing: "border-box",
                                    overflow: "hidden",
                                  }
                                : wrap
                                ? {
                                    whiteSpace: "normal",
                                    wordBreak: "break-word",
                                    overflow: "visible",
                                  }
                                : {}),
                            }}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </div>
                        )}
                      </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
        </TableBody>
      </MuiTable>
    </Box>
  );
}
