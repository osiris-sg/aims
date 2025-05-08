/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import React, { useMemo } from "react";
import { useReactTable, getCoreRowModel, getPaginationRowModel, getSortedRowModel, flexRender, ExpandedState, getExpandedRowModel, SortingState, RowSelectionState } from "@tanstack/react-table";
import { Checkbox, Table as MuiTable, Skeleton } from "@mui/material";
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
      size: 50,
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
    <MuiTable sx={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse" }}>
      <TableHead sx={{ backgroundColor: "tertiary.light", position: "sticky", top: 0, zIndex: 1000 }}>
        {table.getHeaderGroups().map((headerGroup: any) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header: any) => (
              <TableCell
                key={header.id}
                colSpan={header.colSpan}
                sx={{
                  padding: "0.5rem 0.5rem",
                  width: `${header.getSize()}px`,
                  color: "tertiary.dark",
                  borderRight: "0.1px solid", // Add vertical divider
                  borderColor: "tertiary.main",
                  borderBottom: "none",
                  "&:last-child": {
                    borderRight: "none", // Remove border from last column
                  },
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
                  <TableCell key={`loading-${header.id}`} sx={{ width: `${header.getSize()}px`, padding: "0.5rem 0.3rem" }}>
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
                        width: `${cell.column.getSize()}px`,
                        padding: "0.5rem 0.3rem",
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
  );
}
