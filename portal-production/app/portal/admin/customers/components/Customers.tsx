"use client";

import React from "react";
import AdminCard from "@/components/AdminCard";
import PageTable from "@/components/PageTable";
import { useGetCustomers } from "../hooks/useGetCustomers";
import useCustomersTableHeader from "../hooks/useCustomersTableHeader";

export default function Customers() {
  const { columns, deleteDialog } = useCustomersTableHeader();
  const { customers, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters } = useGetCustomers();

  return (
    <AdminCard>
      <PageTable
        loading={loading}
        columns={columns}
        data={customers.docs}
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
