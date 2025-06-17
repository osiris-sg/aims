/* eslint-disable @typescript-eslint/no-explicit-any */
import { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import moment from "moment";
import { Stack, Typography } from "@mui/material";
import { ROUTES } from "@/routes";
import { useSelector } from "react-redux";
import { selectDocuments } from "@/containers/Inventory/slice/selectors";

export default function useViewInventoryTableHeader() {
  const documents = useSelector(selectDocuments);

  const columnsHistory: ColumnDef<any>[] = [
    {
      accessorKey: "message",
      header: "Log Messages",
      cell: ({ row }) => {
        const { message, documentId } = row.original;

        return (
          <Stack spacing={2}>
            <Typography variant="body2">{message}</Typography>
            {documentId && (
              <Stack direction="row" pl={5}>
                <Typography variant="body2">Document:&nbsp;</Typography>
                {(() => {
                  const matchingDoc = Array.isArray(documents) ? documents.find((doc: any) => doc.id === documentId) : null;

                  const type = matchingDoc?.type || "unknown";
                  const documentTemplateId = matchingDoc?.documentTemplateId || "";

                  return (
                    <Link href={`${ROUTES.EDIT_DOCUMENTS}/${type}/${documentTemplateId}/${documentId}`} style={{ textDecoration: "none", color: "secondary.main" }}>
                      {documentId}
                    </Link>
                  );
                })()}
              </Stack>
            )}
          </Stack>
        );
      },
    },
    {
      accessorKey: "createdAt",
      header: "Created Date",
      cell: ({ row }) => moment(row.original.createdAt).format("DD/MM/YYYY HH:mm:ss"),
    },
  ];
  // const sampleDataHistory = [
  //   {
  //     log_message: "Item has been changed from instock to rental",
  //     created_date: "2024.10.10",
  //   },
  //   {
  //     log_message: "Delivery Order has been submitted",
  //     created_date: "2024.10.10",
  //   },
  //   {
  //     log_message: "Item has been changed from rental to instock",
  //     created_date: "2024-10-10",
  //     subRows: [
  //       {
  //         document: "Delivery Order-001",
  //         link: "/path-to-document",
  //       },
  //     ],
  //   },
  // ];

  const columnsDocuments: ColumnDef<any>[] = [
    {
      accessorKey: "templateData.name",
      header: "Document Name",
    },
    {
      accessorKey: "id",
      header: "Document ID",
    },
  ];

  return { columnsHistory, columnsDocuments };
}
