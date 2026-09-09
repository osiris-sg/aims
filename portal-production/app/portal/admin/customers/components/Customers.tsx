"use client";

import React, { useEffect, useState } from "react";
import AdminCard from "@/components/AdminCard";
import PageTable from "@/components/PageTable";
import { useGetCustomers } from "../hooks/useGetCustomers";
import useCustomersTableHeader from "../hooks/useCustomersTableHeader";

export default function Customers() {
  const { columns, deleteDialog, handleViewCustomer } = useCustomersTableHeader();
  // Header sorting is applied to the FULL filtered list inside the hook
  // (before its slice) — the table is in manualSorting mode.
  const [sorting, setSorting] = useState<{ id: string; desc: boolean }[]>([]);
  const { customers, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters } = useGetCustomers(sorting);

  // Sort changes restart at page 1.
  useEffect(() => {
    setPage(1);
  }, [sorting, setPage]);

  return (
    <AdminCard>
      <PageTable
        onRowClick={(r: any) => handleViewCustomer(r)}
        loading={loading}
        columns={columns}
        data={customers.docs}
        manualSorting
        sorting={sorting}
        onSortingChange={setSorting}
        tableName="All Customers (Admin)"
        subTitle="View all customers across organizations"
        // buttonName="View Details"
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        availableFilters={["organization"]}
        pageCount={customers.totalPagesCount}
        totalDocs={customers.totalDocuments}
      />
      {deleteDialog}
    </AdminCard>
  );
}
