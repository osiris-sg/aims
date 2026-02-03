"use client";

import React, { useState } from "react";
import AdminCard from "@/components/AdminCard";
import PageTable from "@/components/PageTable";
import { useGetDocumentTemplates, usePopulateTemplateFields } from "../hooks/useGetDocumentTemplates";
import useDocumentTemplatesTableHeader from "../hooks/useDocumentTemplatesTableHeader";
import {
  Button, Box, Dialog, DialogTitle, DialogContent, DialogActions, Typography,
  CircularProgress, TextField, MenuItem, Select, FormControl, InputLabel,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import SyncIcon from "@mui/icons-material/Sync";
import AddIcon from "@mui/icons-material/Add";
import { toast } from "react-toastify";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";

const DOCUMENT_TYPES = [
  { code: "INVOICE", label: "Tax Invoice" },
  { code: "QUOTATION", label: "Quotation" },
  { code: "DELIVERY_ORDER", label: "Delivery Order" },
  { code: "RETURN_DELIVERY_ORDER", label: "Return Delivery Order" },
  { code: "MAINTENANCE_SERVICE_REPORT", label: "Maintenance Service Report" },
  { code: "PURCHASE_ORDER", label: "Purchase Order" },
  { code: "PURCHASE_RETURN", label: "Purchase Return" },
  { code: "SALES_ORDER", label: "Sales Order" },
  { code: "DEBIT_NOTE", label: "Debit Note" },
  { code: "CREDIT_NOTE", label: "Credit Note" },
  { code: "STOCK_ADJUSTMENT_IN", label: "Stock Adjustment In" },
  { code: "STOCK_ADJUSTMENT_OUT", label: "Stock Adjustment Out" },
];

export default function DocumentTemplates() {
  const { templates, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters, refetch } = useGetDocumentTemplates();
  const { columns, activateDialog } = useDocumentTemplatesTableHeader(refetch);
  const { populateFields, loading: populateLoading } = usePopulateTemplateFields();
  const { getToken } = useAuth();
  const [populateDialogOpen, setPopulateDialogOpen] = useState(false);
  const [populateResult, setPopulateResult] = useState<any>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateType, setNewTemplateType] = useState("");

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

  const handleCreateTemplate = async () => {
    if (!newTemplateName.trim() || !newTemplateType) {
      toast.error("Please fill in all fields");
      return;
    }

    try {
      setCreateLoading(true);
      const token = await getToken();
      if (!token) throw new Error("No token");

      const response = await request(
        { path: "/documentTemplates/create", method: "POST" },
        { name: newTemplateName.trim(), type: newTemplateType },
        token
      );

      if (response.success) {
        toast.success(`Template "${newTemplateName}" created successfully`);
        setCreateDialogOpen(false);
        setNewTemplateName("");
        setNewTemplateType("");
        refetch();
      } else {
        toast.error(response.message || "Failed to create template");
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to create template");
    } finally {
      setCreateLoading(false);
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
        <Button
          variant="contained"
          color="success"
          startIcon={<AddIcon />}
          onClick={() => setCreateDialogOpen(true)}
        >
          Create Template
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

      {/* Create Template Dialog */}
      <Dialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create Document Template</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
            <TextField
              label="Template Name"
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
              placeholder="e.g., Purchase Order Default"
              fullWidth
            />
            <FormControl fullWidth>
              <InputLabel>Document Type</InputLabel>
              <Select
                value={newTemplateType}
                onChange={(e) => setNewTemplateType(e.target.value)}
                label="Document Type"
              >
                {DOCUMENT_TYPES.map((dt) => (
                  <MenuItem key={dt.code} value={dt.code}>
                    {dt.code} - {dt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setCreateDialogOpen(false);
            setNewTemplateName("");
            setNewTemplateType("");
          }}>
            Cancel
          </Button>
          <Button
            onClick={handleCreateTemplate}
            variant="contained"
            color="primary"
            disabled={createLoading || !newTemplateName.trim() || !newTemplateType}
          >
            {createLoading ? "Creating..." : "Create"}
          </Button>
        </DialogActions>
      </Dialog>

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
