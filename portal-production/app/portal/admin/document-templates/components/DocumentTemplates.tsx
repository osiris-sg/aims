"use client";

import React, { useState } from "react";
import AdminCard from "@/components/AdminCard";
import PageTable from "@/components/PageTable";
import { useGetDocumentTemplates, usePopulateTemplateFields } from "../hooks/useGetDocumentTemplates";
import useDocumentTemplatesTableHeader from "../hooks/useDocumentTemplatesTableHeader";
import { Button, Box, Dialog, DialogTitle, DialogContent, DialogActions, Typography, CircularProgress } from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import SyncIcon from "@mui/icons-material/Sync";
import { toast } from "react-toastify";

export default function DocumentTemplates() {
  const { templates, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters, refetch } = useGetDocumentTemplates();
  const { columns, activateDialog } = useDocumentTemplatesTableHeader(refetch);
  const { populateFields, loading: populateLoading } = usePopulateTemplateFields();
  const [populateDialogOpen, setPopulateDialogOpen] = useState(false);
  const [populateResult, setPopulateResult] = useState<any>(null);

  const handlePopulateFields = async () => {
    try {
      const result = await populateFields();
      setPopulateResult(result);
      toast.success(`Populated field definitions for ${result.populated} templates`);
      refetch();
    } catch (error) {
      toast.error("Failed to populate field definitions");
    }
  };

  return (
    <AdminCard>
      <Box sx={{ mb: 2, display: "flex", gap: 2, justifyContent: "flex-end" }}>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={refetch}
          disabled={loading}
        >
          Refresh
        </Button>
        <Button
          variant="contained"
          startIcon={populateLoading ? <CircularProgress size={16} /> : <SyncIcon />}
          onClick={() => setPopulateDialogOpen(true)}
          disabled={populateLoading}
        >
          Populate Default Fields
        </Button>
      </Box>
      <PageTable
        loading={loading}
        columns={columns}
        data={templates.docs}
        tableName="Document Templates"
        subTitle="Manage document template configurations and field definitions"
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        availableFilters={["type"]}
        pageCount={templates.totalPagesCount}
        totalDocs={templates.totalDocuments}
      />
      {activateDialog}

      {/* Populate Fields Confirmation Dialog */}
      <Dialog
        open={populateDialogOpen}
        onClose={() => setPopulateDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Populate Default Field Definitions</DialogTitle>
        <DialogContent>
          {populateResult ? (
            <Box>
              <Typography variant="body1" gutterBottom>
                Field population completed!
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Total templates: {populateResult.total}
              </Typography>
              <Typography variant="body2" color="success.main">
                Populated: {populateResult.populated}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Skipped (already have fields): {populateResult.skipped}
              </Typography>
              {populateResult.errors > 0 && (
                <Typography variant="body2" color="error">
                  Errors: {populateResult.errors}
                </Typography>
              )}
            </Box>
          ) : (
            <Typography variant="body1">
              This will copy default field definitions to all templates that don&apos;t have custom field definitions yet.
              Templates that already have custom fields will not be modified.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setPopulateDialogOpen(false);
            setPopulateResult(null);
          }}>
            {populateResult ? "Close" : "Cancel"}
          </Button>
          {!populateResult && (
            <Button
              onClick={handlePopulateFields}
              variant="contained"
              color="primary"
              disabled={populateLoading}
            >
              {populateLoading ? "Populating..." : "Populate"}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </AdminCard>
  );
}
