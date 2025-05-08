"use client";

import React from "react";

import MainCard from "@/components/MainCard";
import useCustomersTableHeader from "./hooks/useCustomersTableHeader";
import PageTable from "@/components/PageTable";
import AddCustomerItem from "./components/AddCustomer";
import useDeleteCustomerHandler from "./hooks/useDeleteCustomerHandler";
import DeleteItemDialog from "@/components/DeleteItemDialog";
import useAddCustomerStates from "./hooks/useAddCustomerStates";
import { useGetCustomers } from "./hooks/useGetCustomers";

export default function Customers() {
  const { columns } = useCustomersTableHeader();
  const { customers, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters } = useGetCustomers();
  const { openDrawer, onAddClick, onCloseClick } = useAddCustomerStates();
  const { customerToDelete, setCustomerToDelete, isDeleteInProgress, onDeleteConfirm } = useDeleteCustomerHandler();

  return (
    <MainCard>
      <PageTable
        columns={columns}
        data={customers.docs}
        tableName="Customers List"
        subTitle="Customers Detail Information"
        buttonName="Add Customer"
        onAddClick={onAddClick}
        loading={loading}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        availableFilters={["createdOn"]}
        pageCount={customers.totalPagesCount}
        totalDocs={customers.totalDocuments}
      />
      <AddCustomerItem open={openDrawer} onClose={onCloseClick} />
      <DeleteItemDialog open={!!customerToDelete} onCancel={() => setCustomerToDelete(null)} onConfirm={onDeleteConfirm} loading={isDeleteInProgress} />
    </MainCard>
  );
}
