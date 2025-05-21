/* eslint-disable @typescript-eslint/no-explicit-any */
import { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

export default function useViewAssetTableHeader() {
  const columnsHistory: ColumnDef<any>[] = [
    {
      accessorKey: "log_message",
      header: "Log Messages",
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
        return row.original.log_message;
      },
    },
    {
      accessorKey: "created_date",
      header: "Created Date",
    },
  ];
  const sampleDataHistory = [
    {
      log_message: "Item has been changed from Instock to Rental",
      created_date: "2024.10.10",
    },
    {
      log_message: "Delivery Order has been submitted",
      created_date: "2024.10.10",
    },
    {
      log_message: "Item has been changed from Rental to Instock",
      created_date: "2024-10-10",
      subRows: [
        {
          document: "Delivery Order-001",
          link: "/path-to-document",
        },
      ],
    },
  ];

  const columnsDocuments: ColumnDef<any>[] = [
    {
      accessorKey: "doc_name",
      header: "Document Name",
    },
    {
      accessorKey: "doc_id",
      header: "Document ID",
    },
  ];
  const sampleDataDocuments = [
    {
      doc_name: "Return Delivery Order",
      doc_id: "001",
    },
    {
      doc_name: "Delivery Order",
      doc_id: "003",
    },
    {
      doc_name: "Maintenance Report",
      doc_id: "004",
    },
  ];
  return { columnsHistory, sampleDataHistory, columnsDocuments, sampleDataDocuments };
}
