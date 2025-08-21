import { Button, Grid2, IconButton, ToggleButton, Typography, Dialog, DialogTitle, DialogContent, DialogActions, FormControl, InputLabel, Select, MenuItem, Stack, List, ListItem, ListItemText, Divider, CircularProgress, Box, Chip, Skeleton } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import UploadIcon from "@mui/icons-material/Upload";
import React, { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useParams, useRouter } from "next/navigation";
import { request } from "@/helpers/request";
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
  currentDocumentId?: string;
  headerLoading?: boolean;
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

  // Revisions integration
  const router = useRouter();
  const { getToken } = useAuth();
  const params = useParams();
  const routeType = (params as any)?.type as string | undefined;
  const routeTemplateId = (params as any)?.id as string | undefined;
  const canShowRevisions = Boolean(props.currentDocumentId);
  const [revisionDialogOpen, setRevisionDialogOpen] = useState(false);
  const [revisions, setRevisions] = useState<Array<{ id: string; name: string | null; createdAt: string; revisionNumber: number | null }>>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [creatingRevision, setCreatingRevision] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareRows, setCompareRows] = useState<Array<{ key: string; oldValue: any; newValue: any }>>([]);
  const [inventorySkuMap, setInventorySkuMap] = useState<Record<string, string>>({});

  const fetchRevisions = async () => {
    if (!props.currentDocumentId) return;
    setRevisionsLoading(true);
    try {
      const token = await getToken();
      const res = await request({ path: `/documents/${props.currentDocumentId}/revisions`, method: "GET" }, {}, token ?? undefined);
      if (res?.success) {
        setRevisions(res.data || []);
      }
    } catch (e) {
      console.error("Failed to load revisions", e);
    } finally {
      setRevisionsLoading(false);
    }
  };

  const handleOpenRevisions = async () => {
    setRevisionDialogOpen(true);
    await fetchRevisions();
  };

  const handleCreateRevision = async () => {
    if (!props.currentDocumentId) return;
    setCreatingRevision(true);
    try {
      const token = await getToken();
      const res = await request({ path: `/documents/${props.currentDocumentId}/revisions`, method: "POST" }, {}, token ?? undefined);
      const created = res?.data;
      if (created?.id) {
        const nextType = created.type || routeType;
        const nextTemplateId = created.documentTemplateId || routeTemplateId;
        if (nextType && nextTemplateId) {
          router.push(`/portal/documents/${nextType}/${nextTemplateId}/${created.id}`);
        }
      }
    } catch (e) {
      console.error("Create revision failed", e);
    } finally {
      setCreatingRevision(false);
    }
  };

  const shallowDiff = (a: any, b: any) => {
    const keys = Array.from(new Set([...(a ? Object.keys(a) : []), ...(b ? Object.keys(b) : [])]));
    const rows: Array<{ key: string; oldValue: any; newValue: any }> = [];
    for (const k of keys) {
      const av = a ? (a as any)[k] : undefined;
      const bv = b ? (b as any)[k] : undefined;
      const same = JSON.stringify(av) === JSON.stringify(bv);
      if (!same) rows.push({ key: k, oldValue: av, newValue: bv });
    }
    return rows;
  };

  // Render helpers for comparison dialog
  const isPrimitive = (v: any) => v === null || v === undefined || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

  const renderPrimitiveDiff = (oldVal: any, newVal: any) => (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
      <Chip size="small" label="Old" color="default" variant="outlined" />
      <Typography variant="body2" sx={{ mr: 2 }}>
        {String(oldVal ?? "")}
      </Typography>
      <Typography variant="body2" sx={{ mx: 1 }}>
        →
      </Typography>
      <Chip size="small" label="New" color="primary" variant="outlined" />
      <Typography variant="body2">{String(newVal ?? "")}</Typography>
    </Stack>
  );

  const summarizeItem = (item: any, index: number) => {
    const rawId = (item?.inventoryItemId || `#${index + 1}`).toString();
    const sku = inventorySkuMap[rawId];
    const shortId = rawId.length > 8 ? `${rawId.slice(0, 4)}…${rawId.slice(-3)}` : rawId;
    const idPreview = sku || shortId;
    const qty = item?.quantity ?? 1;
    const desc = (item?.description || "").toString();
    return `${idPreview} · Qty: ${qty}${desc ? ` · ${desc}` : ""}`;
  };

  const renderItemsDiff = (oldItems: any[], newItems: any[]) => {
    const byId = (arr: any[]) => {
      const map = new Map<string, any>();
      arr?.forEach((it, idx) => {
        const key = (it && it.inventoryItemId) || `__index_${idx}`;
        map.set(key, it);
      });
      return map;
    };

    const oldMap = byId(Array.isArray(oldItems) ? oldItems : []);
    const newMap = byId(Array.isArray(newItems) ? newItems : []);
    // Avoid iterating Map iterators directly to support older TS targets
    const keySet = new Set<string>();
    oldMap.forEach((_, k) => keySet.add(k));
    newMap.forEach((_, k) => keySet.add(k));
    const keys = Array.from(keySet);

    const added: Array<{ key: string; item: any; idx: number }> = [];
    const removed: Array<{ key: string; item: any; idx: number }> = [];
    const changed: Array<{ key: string; oldItem: any; newItem: any }> = [];

    keys.forEach((k) => {
      const o = oldMap.get(k);
      const n = newMap.get(k);
      if (o && !n) removed.push({ key: k, item: o, idx: 0 });
      else if (!o && n) added.push({ key: k, item: n, idx: 0 });
      else if (o && n && JSON.stringify(o) !== JSON.stringify(n)) changed.push({ key: k, oldItem: o, newItem: n });
    });

    return (
      <Stack spacing={1} sx={{ mt: 0.5 }}>
        {added.length > 0 && (
          <Box>
            <Chip size="small" color="success" label={`Added (${added.length})`} sx={{ mr: 1, mb: 0.5 }} />
            <List dense disablePadding>
              {added.map((a, i) => (
                <ListItem key={`add-${a.key}-${i}`} disableGutters sx={{ py: 0.25 }}>
                  <ListItemText primaryTypographyProps={{ variant: "body2" }} primary={summarizeItem(a.item, i)} />
                </ListItem>
              ))}
            </List>
          </Box>
        )}
        {removed.length > 0 && (
          <Box>
            <Chip size="small" color="error" label={`Removed (${removed.length})`} sx={{ mr: 1, mb: 0.5 }} />
            <List dense disablePadding>
              {removed.map((r, i) => (
                <ListItem key={`rem-${r.key}-${i}`} disableGutters sx={{ py: 0.25 }}>
                  <ListItemText primaryTypographyProps={{ variant: "body2" }} primary={summarizeItem(r.item, i)} />
                </ListItem>
              ))}
            </List>
          </Box>
        )}
        {changed.length > 0 && (
          <Box>
            <Chip size="small" color="warning" label={`Modified (${changed.length})`} sx={{ mr: 1, mb: 0.5 }} />
            <List dense disablePadding>
              {changed.map((c, i) => (
                <ListItem key={`chg-${c.key}-${i}`} disableGutters sx={{ py: 0.25 }}>
                  <ListItemText
                    primaryTypographyProps={{ variant: "body2" }}
                    primary={
                      <Stack spacing={0.5}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {summarizeItem(c.newItem, i)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Qty: {String(c.oldItem?.quantity ?? "")} → {String(c.newItem?.quantity ?? "")} | Tax: {String(c.oldItem?.tax ?? "")} → {String(c.newItem?.tax ?? "")}
                        </Typography>
                      </Stack>
                    }
                  />
                </ListItem>
              ))}
            </List>
          </Box>
        )}
        {added.length === 0 && removed.length === 0 && changed.length === 0 && <Typography variant="body2">No list differences</Typography>}
      </Stack>
    );
  };

  const renderComplexDiff = (key: string, oldVal: any, newVal: any) => {
    // Special handling for items array
    if ((key === "items" && Array.isArray(oldVal)) || (key === "items" && Array.isArray(newVal))) {
      return renderItemsDiff(Array.isArray(oldVal) ? oldVal : [], Array.isArray(newVal) ? newVal : []);
    }
    // Fallback: show pretty JSON side-by-side
    return (
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mt: 0.5 }}>
        <Box sx={{ flex: 1 }}>
          <Chip size="small" label="Old" variant="outlined" sx={{ mb: 0.5 }} />
          <Box component="pre" sx={{ m: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "monospace", fontSize: 12 }}>
            {JSON.stringify(oldVal, null, 2)}
          </Box>
        </Box>
        <Box sx={{ flex: 1 }}>
          <Chip size="small" label="New" color="primary" variant="outlined" sx={{ mb: 0.5 }} />
          <Box component="pre" sx={{ m: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "monospace", fontSize: 12 }}>
            {JSON.stringify(newVal, null, 2)}
          </Box>
        </Box>
      </Stack>
    );
  };

  const handleCompare = async (revId: string) => {
    try {
      const token = await getToken();
      const [currentRes, revRes] = await Promise.all([request({ path: `/documents/${props.currentDocumentId}`, method: "GET" }, {}, token ?? undefined), request({ path: `/documents/${revId}`, method: "GET" }, {}, token ?? undefined)]);
      const currentCfg = currentRes?.data?.config || {};
      const revCfg = revRes?.data?.config || {};
      setCompareRows(shallowDiff(revCfg, currentCfg));
      // Prefetch SKUs for inventory IDs in items
      const collectIds = (arr: any[]) => (Array.isArray(arr) ? arr.map((x) => x?.inventoryItemId).filter(Boolean) : []);
      const ids = Array.from(new Set([...collectIds(revCfg?.items || []), ...collectIds(currentCfg?.items || [])]));
      if (ids.length > 0) {
        try {
          const skuRes = await request({ path: `/inventories/by-ids`, method: "POST" }, { inventoryIds: ids }, token ?? undefined);
          const list = Array.isArray(skuRes?.data) ? skuRes.data : [];
          const map: Record<string, string> = {};
          list.forEach((inv: any) => {
            if (inv?.id) map[inv.id] = inv?.sku || inv?.id;
          });
          setInventorySkuMap(map);
        } catch (e) {
          console.warn("Failed to prefetch SKUs for comparison", e);
        }
      } else {
        setInventorySkuMap({});
      }
      setCompareOpen(true);
    } catch (e) {
      console.error("Compare failed", e);
    }
  };

  const handleViewRevision = async (revId: string) => {
    try {
      const token = await getToken();
      const res = await request({ path: `/documents/${revId}`, method: "GET" }, {}, token ?? undefined);
      const doc = res?.data;
      const nextType = doc?.type || routeType;
      const nextTemplateId = doc?.documentTemplateId || routeTemplateId;
      if (doc?.id && nextType && nextTemplateId) {
        router.push(`/portal/documents/${nextType}/${nextTemplateId}/${doc.id}`);
      }
    } catch (e) {
      console.error("Open revision failed", e);
    }
  };

  return (
    <>
      <Grid2 container spacing={1}>
        <Grid2 size={{ sm: 12, md: 5 }}>
          {props.headerLoading ? (
            <>
              <Skeleton variant="text" sx={{ fontSize: 28, width: 220 }} />
              <Skeleton variant="text" sx={{ fontSize: 14, width: 320 }} />
            </>
          ) : (
            <>
              <Typography variant="h4">{title}</Typography>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                {description}
              </Typography>
            </>
          )}
        </Grid2>

        <Grid2 size={{ sm: 12, md: 7 }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ xs: "stretch", sm: "center" }} justifyContent={{ xs: "flex-start", sm: "flex-end" }}>
            {onPrint && viewMode && (
              <IconButton onClick={() => onPrint()} color="secondary" sx={{ px: 2, gap: 1, borderRadius: "0.7rem", border: "1px solid", borderColor: "tertiary.main" }}>
                <IconPrinter />
              </IconButton>
            )}

            {props.headerLoading ? (
              <Skeleton variant="rounded" height={40} width={44} />
            ) : (
              <ToggleButton value="viewMode" selected={viewMode} onChange={() => toggleViewMode(!viewMode)} color="secondary" sx={{ minWidth: 44, height: 40, px: 1.5, borderRadius: "0.7rem" }}>
                <VisibilityIcon />
              </ToggleButton>
            )}

            {!documentEditMode &&
              (props.headerLoading ? (
                <Skeleton variant="rounded" height={40} width={160} />
              ) : (
                <Button variant="contained" color="secondary" startIcon={<UploadIcon />} onClick={onPrimaryActionSubmit} loading={primaryActionLoading} disabled={primaryActionLoading || primaryActionDisabled} sx={{ height: 40 }} className="truncate">
                  Save template
                </Button>
              ))}

            {!isEditPath &&
              (documentEditMode ? (
                props.headerLoading ? (
                  <Skeleton variant="rounded" height={40} width={180} />
                ) : (
                  <Button variant="contained" color="secondary" startIcon={<UploadIcon />} onClick={handleSubmitClick} loading={secondaryActionLoading} disabled={secondaryActionDisabled || secondaryActionLoading || isDocumentSubmitted} sx={{ height: 40 }}>
                    {isDocumentSubmitted ? "Submitted" : isFormReadyForSubmission ? "Submit Document" : "Update Document"}
                  </Button>
                )
              ) : props.headerLoading ? (
                <Skeleton variant="rounded" height={40} width={180} />
              ) : (
                <Button variant="contained" color="secondary" startIcon={<UploadIcon />} onClick={onSecondaryActionSubmit} loading={secondaryActionLoading} disabled={secondaryActionDisabled || secondaryActionLoading} sx={{ height: 40 }} className="truncate">
                  Create Document
                </Button>
              ))}

            {canShowRevisions &&
              (props.headerLoading ? (
                <Stack direction="row" spacing={1}>
                  <Skeleton variant="rounded" height={40} width={150} />
                  <Skeleton variant="rounded" height={40} width={150} />
                </Stack>
              ) : (
                <Stack direction="row" spacing={1}>
                  <Button variant="outlined" color="secondary" onClick={handleOpenRevisions} disabled={revisionsLoading} sx={{ height: 40 }}>
                    Revision History
                  </Button>
                  <Button variant="contained" color="secondary" onClick={handleCreateRevision} disabled={creatingRevision} sx={{ height: 40 }}>
                    {creatingRevision ? "Creating..." : "Create Revision"}
                  </Button>
                </Stack>
              ))}
          </Stack>
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

      {/* Revision History Dialog */}
      <Dialog open={revisionDialogOpen} onClose={() => setRevisionDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Revision History</DialogTitle>
        <DialogContent>
          {revisionsLoading ? (
            <Stack alignItems="center" sx={{ py: 4 }}>
              <CircularProgress size={24} />
            </Stack>
          ) : (
            <List dense>
              {revisions.map((rev) => (
                <React.Fragment key={rev.id}>
                  <ListItem
                    disableGutters
                    secondaryAction={
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="caption">Rev-{rev.revisionNumber ?? 0}</Typography>
                        <Button size="small" onClick={() => handleViewRevision(rev.id)}>
                          View
                        </Button>
                        <Button size="small" onClick={() => handleCompare(rev.id)}>
                          Compare
                        </Button>
                      </Stack>
                    }
                  >
                    <ListItemText primary={rev.name ?? rev.id} secondary={new Date(rev.createdAt).toLocaleString()} />
                  </ListItem>
                  <Divider component="li" />
                </React.Fragment>
              ))}
              {revisions.length === 0 && <Typography variant="body2">No revisions yet.</Typography>}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevisionDialogOpen(false)} color="secondary">
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Revision Comparison Dialog */}
      <Dialog open={compareOpen} onClose={() => setCompareOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Changes (Selected → Current)</DialogTitle>
        <DialogContent>
          {compareRows.length === 0 ? (
            <Typography variant="body2">No differences detected.</Typography>
          ) : (
            <List dense>
              {compareRows.map((row) => (
                <React.Fragment key={row.key}>
                  <ListItem disableGutters alignItems="flex-start">
                    <ListItemText
                      primary={
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {row.key}
                        </Typography>
                      }
                      secondary={isPrimitive(row.oldValue) && isPrimitive(row.newValue) ? renderPrimitiveDiff(row.oldValue, row.newValue) : renderComplexDiff(row.key, row.oldValue, row.newValue)}
                    />
                  </ListItem>
                  <Divider component="li" />
                </React.Fragment>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCompareOpen(false)} color="secondary">
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
