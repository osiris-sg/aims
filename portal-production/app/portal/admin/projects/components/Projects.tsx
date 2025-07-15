"use client";

import React from "react";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { useGetProjects } from "../hooks/useGetProjects";
import useProjectsTableHeader from "../hooks/useProjectsTableHeader";

export default function Projects() {
  const { columns, deleteDialog } = useProjectsTableHeader();
  const { projects, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters } = useGetProjects();

  return (
    <MainCard>
      <PageTable
        loading={loading}
        columns={columns}
        data={projects.docs}
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
    </MainCard>
  );
}
