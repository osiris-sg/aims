/* eslint-disable @typescript-eslint/no-explicit-any */
import { ColumnDef } from "@tanstack/react-table";

export default function useProjectsTableHeader() {
  const columns: ColumnDef<any>[] = [
    {
      accessorKey: "sku",
      header: "SKU-Key",
    },
    {
      accessorKey: "name",
      header: "Product Name",
    },
    {
      accessorKey: "image",
      header: "Image",
    },
    {
      accessorKey: "category",
      header: "Category",
    },
    {
      accessorKey: "status_instock",
      header: "Status-In Stock",
    },
    {
      accessorKey: "status",
      header: "Status",
    },
    {
      accessorKey: "action",
      header: "Action",
    },
  ];

  const sampleData = [
    {
      sku: "SKU001",
      name: "Product Name",
      image: "Image",
      category: "Category",
      status: "Status",
      actions: "Actions",
    },
    {
      sku: "SKU002",
      name: "Product Name",
      image: "Image",
      category: "Category",
    },
    {
      sku: "SKU003",
      name: "Product Name",
      image: "Image",
      category: "Category",
    },
  ];
  return { columns, sampleData };
}
