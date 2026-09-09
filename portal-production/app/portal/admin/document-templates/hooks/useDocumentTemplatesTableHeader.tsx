"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createColumnHelper } from "@tanstack/react-table";
import { Chip, Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import { kebabColumn } from "@/components/RowKebab";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { toast } from "react-toastify";

const columnHelper = createColumnHelper<any>();

export default function useDocumentTemplatesTableHeader(onRefetch?: () => void) {
  const router = useRouter();
  const { getToken } = useAuth();
  const [activateDialog, setActivateDialog] = useState<{ open: boolean; templateId: string; templateName: string }>({
    open: false,
    templateId: "",
    templateName: "",
  });

  const handleActivate = async () => {
    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/documentTemplates/variants/${activateDialog.templateId}/activate`,
          method: "POST",
        },
        {},
        token
      );

      if (response.success) {
        toast.success(`Template "${activateDialog.templateName}" activated successfully`);
        onRefetch?.();
      } else {
        toast.error(response.message || "Failed to activate template");
      }
    } catch (error) {
      console.error("Error activating template:", error);
      toast.error("Failed to activate template");
    } finally {
      setActivateDialog({ open: false, templateId: "", templateName: "" });
    }
  };

  const openTemplate = (row: any) => router.push(`/portal/admin/document-templates/${row.id}`);

  const columns = [
    columnHelper.accessor("name", {
      header: "Template Name",
      cell: (info) => <Typography variant="body2">{info.getValue()}</Typography>,
    }),
    columnHelper.accessor("type", {
      header: "Document Type",
      cell: (info) => (
        <Chip
          label={info.getValue()}
          size="small"
          variant="outlined"
          color="primary"
        />
      ),
    }),
    columnHelper.accessor("templateVariant", {
      header: "Variant",
      cell: (info) => (
        <Chip
          label={info.getValue() || info.row.original.designName || "Default"}
          size="small"
          color="secondary"
        />
      ),
    }),
    columnHelper.accessor("isActive", {
      header: "Status",
      cell: (info) => (
        <Chip
          label={info.getValue() ? "Active" : "Inactive"}
          size="small"
          color={info.getValue() ? "success" : "default"}
          icon={info.getValue() ? <CheckCircleIcon /> : <RadioButtonUncheckedIcon />}
        />
      ),
    }),
    columnHelper.accessor("config", {
      id: "hasCustomFields",
      header: "Custom Fields",
      cell: (info) => {
        const hasCustomFields = info.getValue()?.formFields != null;
        return (
          <Chip
            label={hasCustomFields ? "Custom" : "Default"}
            size="small"
            color={hasCustomFields ? "info" : "default"}
            variant={hasCustomFields ? "filled" : "outlined"}
          />
        );
      },
    }),
    columnHelper.accessor("organization.name", {
      header: "Organization",
      cell: (info) => <Typography variant="body2">{info.getValue() || "N/A"}</Typography>,
    }),
    kebabColumn((row: any) => [
      { label: "View Template", onClick: () => openTemplate(row) },
      { label: "Edit Fields", onClick: () => router.push(`/portal/admin/document-templates/${row.id}/fields`) },
      {
        label: row.isActive ? "Already Active" : "Activate Template",
        disabled: row.isActive,
        onClick: () =>
          setActivateDialog({
            open: true,
            templateId: row.id,
            templateName: row.name,
          }),
      },
    ]),
  ];

  const activateDialogComponent = (
    <Dialog
      open={activateDialog.open}
      onClose={() => setActivateDialog({ open: false, templateId: "", templateName: "" })}
    >
      <DialogTitle>Activate Template</DialogTitle>
      <DialogContent>
        Are you sure you want to activate template &quot;{activateDialog.templateName}&quot;?
        This will deactivate any other active template of the same type.
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setActivateDialog({ open: false, templateId: "", templateName: "" })}>
          Cancel
        </Button>
        <Button onClick={handleActivate} variant="contained" color="primary">
          Activate
        </Button>
      </DialogActions>
    </Dialog>
  );

  return {
    columns,
    activateDialog: activateDialogComponent,
    openTemplate,
  };
}
