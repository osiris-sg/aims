import { Button, Grid2, IconButton, ToggleButton, Typography } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import UploadIcon from "@mui/icons-material/Upload";
import React from "react";
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
}
export default function DocumentNameHeader(props: Props) {
  const { onPrint, title, description, viewMode, toggleViewMode, onPrimaryActionSubmit, onSecondaryActionSubmit, primaryActionLoading = false, primaryActionDisabled, secondaryActionDisabled, secondaryActionLoading, documentEditMode = false } = props;

  return (
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
        {!documentEditMode ? (
          <Grid2 size={{ xs: 6, md: 5 }}>
            <Button variant="contained" color="secondary" startIcon={<UploadIcon />} onClick={onSecondaryActionSubmit} loading={secondaryActionLoading} disabled={secondaryActionDisabled || secondaryActionLoading} className="truncate">
              Create Document
            </Button>
          </Grid2>
        ) : (
          <Grid2 size={{ xs: 6, md: 5 }}>
            <Button variant="contained" color="secondary" startIcon={<UploadIcon />} onClick={onSecondaryActionSubmit} loading={secondaryActionLoading} disabled={secondaryActionDisabled || secondaryActionLoading}>
              Update Document
            </Button>
          </Grid2>
        )}
      </Grid2>
    </Grid2>
  );
}
