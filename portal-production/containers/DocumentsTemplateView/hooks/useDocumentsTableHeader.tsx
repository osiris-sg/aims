/* eslint-disable @typescript-eslint/no-explicit-any */
import { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

export default function useDocumentsTableHeader() {
  const columns: ColumnDef<any>[] = [
    {
      accessorKey: "name",
      header: "Document Name",
      cell: ({ row }) => {
        // If it's a subrow, render the document info
        if (row.original.document) {
          return (
            <Link href={row.original.link} style={{ textDecoration: "none", color: "secondary.main", paddingLeft: "var(--default-padding)" }}>
              {row.original.document}
            </Link>
          );
        }
        // Otherwise render the normal log message
        return row.original.name;
      },
    },
  ];

  return { columns };
}
