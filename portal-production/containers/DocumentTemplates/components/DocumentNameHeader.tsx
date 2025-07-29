import { Button, Grid2, IconButton, ToggleButton, Typography, Dialog, DialogTitle, DialogContent, DialogActions, FormControl, InputLabel, Select, MenuItem } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import UploadIcon from "@mui/icons-material/Upload";
import React, { useState } from "react";
import { IconPrinter } from "@tabler/icons-react";

interface Props {
  title: string;
  description: string;
  viewMode: boolean;
  toggleViewMode: (mode: boolean) => void;
  onPrimaryActionSubmit: () => void;
  onSecondaryActionSubmit: () => void;
  primaryActionLoading?: boolean;
  secondaryActionLoading?: boolean;
  primaryActionDisabled?: boolean;
  secondaryActionDisabled?: boolean;
  onPrint?: () => void;
  documentEditMode?: boolean;
  isEditPath?: boolean;
  isFormReadyForSubmission?: boolean;
  onSubmitWithStatus?: (status: string) => void; // New prop for status submission
  documentStatus?: string; // New prop for document status
}

export default function DocumentNameHeader(props: Props) {
  const {
    onPrint,
    title,
    description,
    viewMode,
    toggleViewMode,
    onPrimaryActionSubmit,
    onSecondaryActionSubmit,
    primaryActionLoading = false,
    primaryActionDisabled,
    secondaryActionDisabled,
    secondaryActionLoading,
    documentEditMode = false,
    isEditPath,
    isFormReadyForSubmission = false,
    onSubmitWithStatus,
    documentStatus,
  } = props;

  // State for status selection dialog
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState("");

  // Check if document is submitted (not in draft status)
  const isDocumentSubmitted = Boolean(documentStatus && documentStatus !== "draft");

  // Handle submit button click
  const handleSubmitClick = () => {
    if (isDocumentSubmitted) {
      // Do nothing if document is already submitted
      return;
    }

    if (isFormReadyForSubmission && title === "Delivery Order") {
      // Open status selection dialog for DO template
      setStatusDialogOpen(true);
    } else {
      // Regular update for other templates or when not ready
      onSecondaryActionSubmit();
    }
  };

  // Handle status submission
  const handleStatusSubmit = () => {
    if (selectedStatus && onSubmitWithStatus) {
      onSubmitWithStatus(selectedStatus);
    } else {
      onSecondaryActionSubmit();
    }
    setStatusDialogOpen(false);
    setSelectedStatus("");
  };

  // Handle dialog close
  const handleDialogClose = () => {
    setStatusDialogOpen(false);
    setSelectedStatus("");
  };

  console.log("DocumentNameHeader props", props.isEditPath);

  return (
    <>
      <Grid2 container spacing={1}>
        <Grid2 size={{ sm: 12, md: 5 }}>
          <Typography variant="h4">{title}</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {description}
          </Typography>
        </Grid2>

        <Grid2 size={{ sm: 12, md: 7 }} container spacing={1}>
          {onPrint && viewMode && (
            <Grid2 size={{ xs: 1 }}>
              <IconButton onClick={() => onPrint()} color="secondary" sx={{ px: 2, gap: 1, borderRadius: "0.7rem", border: "1px solid", borderColor: "tertiary.main" }}>
                <IconPrinter />
              </IconButton>
            </Grid2>
          )}
          <Grid2 size={{ xs: 12, md: 2 }}>
            <ToggleButton value="viewMode" selected={viewMode} onChange={() => toggleViewMode(!viewMode)} color="secondary" sx={{ px: 2, gap: 1, borderRadius: "0.7rem" }}>
              <VisibilityIcon />
            </ToggleButton>
          </Grid2>
          {!documentEditMode && (
            <Grid2 size={{ xs: 6, md: 5 }}>
              <Button variant="contained" color="secondary" startIcon={<UploadIcon />} onClick={onPrimaryActionSubmit} loading={primaryActionLoading} disabled={primaryActionLoading || primaryActionDisabled} className="truncate">
                Save template
              </Button>
            </Grid2>
          )}
          {!isEditPath &&
            (!documentEditMode ? (
              <Grid2 size={{ xs: 6, md: 5 }}>
                <Button variant="contained" color="secondary" startIcon={<UploadIcon />} onClick={onSecondaryActionSubmit} loading={secondaryActionLoading} disabled={secondaryActionDisabled || secondaryActionLoading} className="truncate">
                  Create Document
                </Button>
              </Grid2>
            ) : (
              <Grid2 size={{ xs: 6, md: 5 }}>
                <Button variant="contained" color="secondary" startIcon={<UploadIcon />} onClick={handleSubmitClick} loading={secondaryActionLoading} disabled={secondaryActionDisabled || secondaryActionLoading || isDocumentSubmitted}>
                  {isDocumentSubmitted ? "Submitted" : isFormReadyForSubmission ? "Submit Document" : "Update Document"}
                </Button>
              </Grid2>
            ))}
        </Grid2>
      </Grid2>

      {/* Status Selection Dialog */}
      <Dialog open={statusDialogOpen} onClose={handleDialogClose} maxWidth="sm" fullWidth>
        <DialogTitle>Select Delivery Status</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 3, color: "text.secondary" }}>
            Please select the current status of this delivery order:
          </Typography>
          <FormControl fullWidth>
            <InputLabel id="status-select-label">Delivery Status</InputLabel>
            <Select labelId="status-select-label" id="status-select" value={selectedStatus} label="Delivery Status" onChange={(e) => setSelectedStatus(e.target.value)}>
              <MenuItem value="delivered_not_installed">Delivered - Not Installed</MenuItem>
              <MenuItem value="delivered_installed">Delivered - Installed</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDialogClose} color="secondary">
            Cancel
          </Button>
          <Button onClick={handleStatusSubmit} variant="contained" color="primary" disabled={!selectedStatus}>
            Submit Document
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
