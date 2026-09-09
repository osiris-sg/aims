"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminCard from "@/components/AdminCard";
import PageTable from "@/components/PageTable";
import { useGetProjects } from "../hooks/useGetProjects";
import useProjectsTableHeader from "../hooks/useProjectsTableHeader";

export default function Projects() {
  const router = useRouter();
  const { columns, deleteDialog } = useProjectsTableHeader();
  // Header sorting is applied to the FULL filtered list inside the hook
  // (before its slice) — the table is in manualSorting mode.
  const [sorting, setSorting] = useState<{ id: string; desc: boolean }[]>([]);
  const { projects, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters } = useGetProjects(sorting);

  // Sort changes restart at page 1.
  useEffect(() => {
    setPage(1);
  }, [sorting, setPage]);

  return (
    <AdminCard>
      <PageTable
        onRowClick={(r: any) => router.push(`/portal/projects/${r.id}`)}
        loading={loading}
        columns={columns}
        data={projects.docs}
        manualSorting
        sorting={sorting}
        onSortingChange={setSorting}
        tableName="All Projects (Admin)"
        subTitle="View all projects across organizations"
        // buttonName="View Details"
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        availableFilters={["status", "organization"]}
        pageCount={projects.totalPagesCount}
        totalDocs={projects.totalDocuments}
      />
      {deleteDialog}
    </AdminCard>
  );
}
