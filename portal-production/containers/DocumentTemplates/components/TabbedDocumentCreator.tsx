"use client";

import React, { useState } from "react";
import {
  Box,
  Tabs,
  Tab,
  Paper,
  Grid,
  Typography,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Card,
  CardContent,
  Divider,
  Autocomplete,
  FormControlLabel,
  Checkbox,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
} from "@mui/material";
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Print as PrintIcon,
  Save as SaveIcon,
  Preview as PreviewIcon,
  Edit as EditIcon,
  Download as DownloadIcon,
  PictureAsPdf as PdfIcon,
} from "@mui/icons-material";
import CleanDocumentPreview from "./CleanDocumentPreview";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { toast } from "react-toastify";

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div role="tabpanel" hidden={value !== index} {...other}>
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

interface DocumentCreatorProps {
  documentType: "QO1" | "DO" | "RDO" | "TI" | "MSR";
  onSave?: (data: any) => void;
  onPrint?: () => void;
  existingData?: any;
  customers?: any[];
  projects?: any[];
  deliveryOrders?: any[];
}

export default function TabbedDocumentCreator({
  documentType,
  onSave,
  onPrint,
  existingData,
  customers = [],
  projects = [],
  deliveryOrders = [],
  documentId,
}: DocumentCreatorProps) {
  // Main tabs
  const [mainTabValue, setMainTabValue] = useState(0);
  // Items section tabs
  const [itemsTabValue, setItemsTabValue] = useState(0);
  const [previewMode, setPreviewMode] = useState(false);

  // PDF generation states
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const { getToken } = useAuth();

  // Form data state
  const [formData, setFormData] = useState({
    // General tab data
    company: {
      name: existingData?.company?.name || "",
      address: existingData?.company?.address || "",
      phoneNumber: existingData?.company?.phoneNumber || "",
      gstRegNo: existingData?.gstRegNo || "",
    },
    customer: {
      id: existingData?.customerId || "",
      name: "",
      address: "",
    },
    documentInfo: {
      date: existingData?.date || new Date().toISOString().split("T")[0],
      documentNumber: existingData?.documentNumber || "",
      referenceNo: existingData?.referenceNo || "",
      poNo: existingData?.poNo || "",
      doNo: existingData?.doNo || "",
    },
    // Details tab data
    projectId: existingData?.projectId || "",
    salesPerson: existingData?.salesPerson || "",
    salesContact: existingData?.salesContact || "",
    paymentTerms: existingData?.paymentTerms || "30 days",
    dueDate: existingData?.dueDate || "",
    // Delivery Address tab data
    deliveryAddress: {
      attention: existingData?.attention?.name || "",
      phone: existingData?.attention?.phoneNumber || "",
      address: existingData?.deliveryTo || "",
      instructions: existingData?.deliveryInstructions || "",
    },
    // Items data
    items: existingData?.items || [],
    // Footer data
    note: existingData?.note || "",
    termsAndConditions: existingData?.termsAndConditions || "",
    bankDetails: existingData?.bankDetails || "",
  });

  // Items management
  const [items, setItems] = useState(existingData?.items || []);

  const addNewItem = () => {
    setItems([
      ...items,
      {
        id: Date.now(),
        description: "",
        quantity: 1,
        unitPrice: 0,
        tax: 9,
        amount: 0,
      },
    ]);
  };

  const deleteItem = (id: number) => {
    setItems(items.filter((item: any) => item.id !== id));
  };

  const updateItem = (id: number, field: string, value: any) => {
    setItems(
      items.map((item: any) => {
        if (item.id === id) {
          const updated = { ...item, [field]: value };
          // Calculate amount
          updated.amount = updated.quantity * updated.unitPrice;
          return updated;
        }
        return item;
      })
    );
  };

  // Calculations
  const subtotal = items.reduce((acc: number, item: any) => acc + (item.amount || 0), 0);
  const totalTax = items.reduce((acc: number, item: any) => acc + (item.amount || 0) * (item.tax / 100), 0);
  const total = subtotal + totalTax;

  const handleMainTabChange = (_: React.SyntheticEvent, newValue: number) => {
    setMainTabValue(newValue);
  };

  const handleItemsTabChange = (_: React.SyntheticEvent, newValue: number) => {
    setItemsTabValue(newValue);
  };

  const getDocumentTitle = () => {
    const titles = {
      QO1: "Quotation",
      DO: "Delivery Order",
      RDO: "Return Delivery Order",
      TI: "Tax Invoice",
      MSR: "Maintenance Service Report",
    };
    return titles[documentType] || "Document";
  };

  // Generate PDF and upload to S3
  const generatePdf = async () => {
    try {
      setPdfUrl(null); // Reset any previous PDF URL
      setIsGeneratingPdf(true);
      setPdfDialogOpen(true);

      const token = await getToken();
      if (!token) {
        throw new Error("Authentication token not found");
      }

      // Prepare document data with items
      const documentData = {
        ...formData,
        items: items,
      };

      // Call backend to generate PDF
      const response = await request(
        {
          path: "/documents/generate-pdf",
          method: "POST",
        },
        {
          documentType,
          documentId: documentId || `temp_${Date.now()}`,
          data: documentData,
        },
        token
      );

      console.log("PDF Generation Response:", response);

      // The response has the URL nested in response.data.url
      if (response && response.data && response.data.url) {
        setPdfUrl(response.data.url);
        setIsGeneratingPdf(false);
        toast.success("PDF generated successfully!");
      } else if (response && response.success === false) {
        // Error response from request helper
        setIsGeneratingPdf(false);
        throw new Error(response.message || "Failed to generate PDF");
      } else {
        // Unexpected response structure
        console.error("Unexpected response structure:", response);
        setIsGeneratingPdf(false);
        toast.error("Failed to generate PDF - unexpected response");
        setPdfDialogOpen(false);
      }
    } catch (error) {
      console.error("Error generating PDF:", error);
      setIsGeneratingPdf(false);
      toast.error("Failed to generate PDF. Please try again.");
      setPdfDialogOpen(false);
    }
  };

  const handleDownloadPdf = () => {
    if (pdfUrl) {
      // Open PDF in new tab
      window.open(pdfUrl, "_blank");
    }
  };

  const handlePrint = () => {
    // Generate PDF instead of browser print
    generatePdf();
  };

  return (
    <Box sx={{ width: "100%", height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Header Actions */}
      <Box
        sx={{
          p: 2,
          borderBottom: 1,
          borderColor: "divider",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Typography variant="h5" fontWeight="bold">
          {getDocumentTitle()} - {formData.documentInfo.documentNumber || "New"}
        </Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button
            variant="outlined"
            startIcon={previewMode ? <EditIcon /> : <PreviewIcon />}
            onClick={() => setPreviewMode(!previewMode)}
          >
            {previewMode ? "Edit" : "Preview"}
          </Button>
          <Button variant="outlined" startIcon={<PrintIcon />} onClick={handlePrint}>
            Print / PDF
          </Button>
          <Button variant="contained" startIcon={<SaveIcon />} onClick={() => onSave?.(formData)}>
            Save Document
          </Button>
        </Box>
      </Box>

      {/* Main Content */}
      {!previewMode ? (
        <Box sx={{ flex: 1, overflow: "auto" }}>
          {/* Main Tabs */}
          <Box sx={{ borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
            <Tabs value={mainTabValue} onChange={handleMainTabChange}>
              <Tab label="General" />
              <Tab label="Details" />
              <Tab label="Delivery Address" />
            </Tabs>
          </Box>

          {/* GENERAL TAB */}
          <TabPanel value={mainTabValue} index={0}>
            <Grid container spacing={3}>
              {/* Company Information */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Company Information
                    </Typography>
                    <Divider sx={{ mb: 2 }} />
                    <Grid container spacing={2}>
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="Company Name"
                          value={formData.company.name}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              company: { ...formData.company, name: e.target.value },
                            })
                          }
                          size="small"
                        />
                      </Grid>
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="Company Address"
                          value={formData.company.address}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              company: { ...formData.company, address: e.target.value },
                            })
                          }
                          size="small"
                          multiline
                          rows={2}
                        />
                      </Grid>
                      <Grid item xs={6}>
                        <TextField
                          fullWidth
                          label="Phone Number"
                          value={formData.company.phoneNumber}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              company: { ...formData.company, phoneNumber: e.target.value },
                            })
                          }
                          size="small"
                        />
                      </Grid>
                      <Grid item xs={6}>
                        <TextField
                          fullWidth
                          label="GST Reg No"
                          value={formData.company.gstRegNo}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              company: { ...formData.company, gstRegNo: e.target.value },
                            })
                          }
                          size="small"
                        />
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>

              {/* Customer Information */}
              <Grid item xs={12} md={6}>
                <Card>
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Customer Information
                    </Typography>
                    <Divider sx={{ mb: 2 }} />
                    <Grid container spacing={2}>
                      <Grid item xs={12}>
                        <Autocomplete
                          options={customers}
                          getOptionLabel={(option) => option.name}
                          value={customers.find((c) => c.id === formData.customer.id) || null}
                          onChange={(_, newValue) =>
                            setFormData({
                              ...formData,
                              customer: {
                                id: newValue?.id || "",
                                name: newValue?.name || "",
                                address: newValue?.address || "",
                              },
                            })
                          }
                          renderInput={(params) => (
                            <TextField {...params} label="Select Customer" size="small" />
                          )}
                        />
                      </Grid>
                      {formData.customer.name && (
                        <>
                          <Grid item xs={12}>
                            <Paper sx={{ p: 2, bgcolor: "grey.50" }}>
                              <Typography variant="body1" fontWeight={500}>
                                {formData.customer.name}
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                {formData.customer.address}
                              </Typography>
                            </Paper>
                          </Grid>
                        </>
                      )}
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>

              {/* Document Information */}
              <Grid item xs={12}>
                <Card>
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Document Information
                    </Typography>
                    <Divider sx={{ mb: 2 }} />
                    <Grid container spacing={2}>
                      <Grid item xs={12} md={3}>
                        <TextField
                          fullWidth
                          label="Date"
                          type="date"
                          value={formData.documentInfo.date}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              documentInfo: { ...formData.documentInfo, date: e.target.value },
                            })
                          }
                          size="small"
                          InputLabelProps={{ shrink: true }}
                        />
                      </Grid>
                      <Grid item xs={12} md={3}>
                        <TextField
                          fullWidth
                          label={`${getDocumentTitle()} Number`}
                          value={formData.documentInfo.documentNumber}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              documentInfo: {
                                ...formData.documentInfo,
                                documentNumber: e.target.value,
                              },
                            })
                          }
                          size="small"
                        />
                      </Grid>
                      <Grid item xs={12} md={3}>
                        <TextField
                          fullWidth
                          label="Reference No"
                          value={formData.documentInfo.referenceNo}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              documentInfo: {
                                ...formData.documentInfo,
                                referenceNo: e.target.value,
                              },
                            })
                          }
                          size="small"
                        />
                      </Grid>
                      {documentType === "TI" && (
                        <Grid item xs={12} md={3}>
                          <FormControl fullWidth size="small">
                            <InputLabel>DO No</InputLabel>
                            <Select
                              value={formData.documentInfo.doNo}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  documentInfo: {
                                    ...formData.documentInfo,
                                    doNo: e.target.value,
                                  },
                                })
                              }
                              label="DO No"
                            >
                              {deliveryOrders.map((order) => (
                                <MenuItem key={order.id} value={order.doNo}>
                                  {order.doNo} - {order.name}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </Grid>
                      )}
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </TabPanel>

          {/* DETAILS TAB */}
          <TabPanel value={mainTabValue} index={1}>
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <Card>
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Additional Details
                    </Typography>
                    <Divider sx={{ mb: 2 }} />
                    <Grid container spacing={2}>
                      <Grid item xs={12} md={6}>
                        <Autocomplete
                          options={projects}
                          getOptionLabel={(option) => option.name}
                          value={projects.find((p) => p.id === formData.projectId) || null}
                          onChange={(_, newValue) =>
                            setFormData({
                              ...formData,
                              projectId: newValue?.id || "",
                            })
                          }
                          renderInput={(params) => (
                            <TextField {...params} label="Project" size="small" />
                          )}
                        />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          fullWidth
                          label="Sales Person"
                          value={formData.salesPerson}
                          onChange={(e) =>
                            setFormData({ ...formData, salesPerson: e.target.value })
                          }
                          size="small"
                        />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          fullWidth
                          label="Sales Contact"
                          value={formData.salesContact}
                          onChange={(e) =>
                            setFormData({ ...formData, salesContact: e.target.value })
                          }
                          size="small"
                        />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Payment Terms</InputLabel>
                          <Select
                            value={formData.paymentTerms}
                            onChange={(e) =>
                              setFormData({ ...formData, paymentTerms: e.target.value })
                            }
                            label="Payment Terms"
                          >
                            <MenuItem value="Immediate">Immediate</MenuItem>
                            <MenuItem value="7 days">7 days</MenuItem>
                            <MenuItem value="14 days">14 days</MenuItem>
                            <MenuItem value="30 days">30 days</MenuItem>
                            <MenuItem value="60 days">60 days</MenuItem>
                            <MenuItem value="90 days">90 days</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          fullWidth
                          label="Due Date"
                          type="date"
                          value={formData.dueDate}
                          onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                          size="small"
                          InputLabelProps={{ shrink: true }}
                        />
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </TabPanel>

          {/* DELIVERY ADDRESS TAB */}
          <TabPanel value={mainTabValue} index={2}>
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <Card>
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Delivery Information
                    </Typography>
                    <Divider sx={{ mb: 2 }} />
                    <Grid container spacing={2}>
                      <Grid item xs={12} md={6}>
                        <TextField
                          fullWidth
                          label="Attention To"
                          value={formData.deliveryAddress.attention}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              deliveryAddress: {
                                ...formData.deliveryAddress,
                                attention: e.target.value,
                              },
                            })
                          }
                          size="small"
                        />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          fullWidth
                          label="Contact Phone"
                          value={formData.deliveryAddress.phone}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              deliveryAddress: {
                                ...formData.deliveryAddress,
                                phone: e.target.value,
                              },
                            })
                          }
                          size="small"
                        />
                      </Grid>
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="Delivery Address"
                          value={formData.deliveryAddress.address}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              deliveryAddress: {
                                ...formData.deliveryAddress,
                                address: e.target.value,
                              },
                            })
                          }
                          size="small"
                          multiline
                          rows={3}
                        />
                      </Grid>
                      <Grid item xs={12}>
                        <TextField
                          fullWidth
                          label="Delivery Instructions"
                          value={formData.deliveryAddress.instructions}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              deliveryAddress: {
                                ...formData.deliveryAddress,
                                instructions: e.target.value,
                              },
                            })
                          }
                          size="small"
                          multiline
                          rows={2}
                        />
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </TabPanel>

          {/* ITEMS SECTION WITH TABS */}
          <Box sx={{ mt: 3, mx: 3 }}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Items
                </Typography>
                <Divider />

                {/* Items Sub-tabs */}
                <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
                  <Tabs value={itemsTabValue} onChange={handleItemsTabChange}>
                    <Tab label="Details" />
                    <Tab label="Footer" />
                  </Tabs>
                </Box>

                {/* ITEMS DETAILS TAB */}
                <TabPanel value={itemsTabValue} index={0}>
                  <Box>
                    <TableContainer>
                      <Table>
                        <TableHead>
                          <TableRow>
                            <TableCell>Item</TableCell>
                            <TableCell>Description</TableCell>
                            <TableCell align="center">Quantity</TableCell>
                            <TableCell align="center">Unit Price</TableCell>
                            <TableCell align="center">Tax %</TableCell>
                            <TableCell align="right">Amount</TableCell>
                            <TableCell align="center">Actions</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {items.map((item: any, index: number) => (
                            <TableRow key={item.id}>
                              <TableCell>{index + 1}</TableCell>
                              <TableCell>
                                <TextField
                                  fullWidth
                                  value={item.description}
                                  onChange={(e) => updateItem(item.id, "description", e.target.value)}
                                  size="small"
                                  placeholder="Enter description"
                                />
                              </TableCell>
                              <TableCell align="center">
                                <TextField
                                  type="number"
                                  value={item.quantity}
                                  onChange={(e) =>
                                    updateItem(item.id, "quantity", parseFloat(e.target.value))
                                  }
                                  size="small"
                                  sx={{ width: 80 }}
                                />
                              </TableCell>
                              <TableCell align="center">
                                <TextField
                                  type="number"
                                  value={item.unitPrice}
                                  onChange={(e) =>
                                    updateItem(item.id, "unitPrice", parseFloat(e.target.value))
                                  }
                                  size="small"
                                  sx={{ width: 100 }}
                                />
                              </TableCell>
                              <TableCell align="center">
                                <TextField
                                  type="number"
                                  value={item.tax}
                                  onChange={(e) =>
                                    updateItem(item.id, "tax", parseFloat(e.target.value))
                                  }
                                  size="small"
                                  sx={{ width: 60 }}
                                />
                              </TableCell>
                              <TableCell align="right">
                                {(item.amount || 0).toFixed(2)}
                              </TableCell>
                              <TableCell align="center">
                                <IconButton
                                  size="small"
                                  onClick={() => deleteItem(item.id)}
                                  color="error"
                                >
                                  <DeleteIcon />
                                </IconButton>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>

                    <Button
                      variant="contained"
                      startIcon={<AddIcon />}
                      onClick={addNewItem}
                      sx={{ mt: 2 }}
                      size="small"
                    >
                      Add Item
                    </Button>

                    {/* Totals */}
                    <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 3 }}>
                      <Card sx={{ minWidth: 300, bgcolor: "grey.50" }}>
                        <CardContent>
                          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                            <Typography>Subtotal:</Typography>
                            <Typography fontWeight="bold">SGD {subtotal.toFixed(2)}</Typography>
                          </Box>
                          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                            <Typography>Tax:</Typography>
                            <Typography>SGD {totalTax.toFixed(2)}</Typography>
                          </Box>
                          <Divider sx={{ my: 1 }} />
                          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                            <Typography fontWeight="bold">Total:</Typography>
                            <Typography fontWeight="bold" color="primary">
                              SGD {total.toFixed(2)}
                            </Typography>
                          </Box>
                        </CardContent>
                      </Card>
                    </Box>
                  </Box>
                </TabPanel>

                {/* ITEMS FOOTER TAB */}
                <TabPanel value={itemsTabValue} index={1}>
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Notes"
                        value={formData.note}
                        onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                        multiline
                        rows={4}
                        size="small"
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        fullWidth
                        label="Terms & Conditions"
                        value={formData.termsAndConditions}
                        onChange={(e) =>
                          setFormData({ ...formData, termsAndConditions: e.target.value })
                        }
                        multiline
                        rows={4}
                        size="small"
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <TextField
                        fullWidth
                        label="Bank Details"
                        value={formData.bankDetails}
                        onChange={(e) => setFormData({ ...formData, bankDetails: e.target.value })}
                        multiline
                        rows={3}
                        size="small"
                      />
                    </Grid>
                  </Grid>
                </TabPanel>
              </CardContent>
            </Card>
          </Box>
        </Box>
      ) : (
        // PREVIEW MODE - Show clean document layout
        <Box sx={{ flex: 1, overflow: "auto", p: 2, bgcolor: "grey.100" }}>
          <CleanDocumentPreview
            documentType={documentType}
            data={{
              ...formData,
              items: items,
            }}
          />
        </Box>
      )}

      {/* PDF Generation Dialog */}
      <Dialog
        open={pdfDialogOpen}
        onClose={() => !isGeneratingPdf && setPdfDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <PdfIcon color="primary" />
            Document PDF
          </Box>
        </DialogTitle>
        <DialogContent>
          {isGeneratingPdf ? (
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", py: 3 }}>
              <CircularProgress size={48} />
              <Typography sx={{ mt: 2 }}>Generating PDF...</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Please wait while we create your document
              </Typography>
            </Box>
          ) : pdfUrl ? (
            <Box sx={{ py: 2 }}>
              <Typography variant="body1" gutterBottom>
                Your PDF has been generated successfully!
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                The document is ready for download or printing.
              </Typography>

              <Box sx={{ display: "flex", gap: 2, justifyContent: "center" }}>
                <Button
                  variant="contained"
                  startIcon={<DownloadIcon />}
                  onClick={handleDownloadPdf}
                  size="large"
                  fullWidth
                >
                  Open PDF
                </Button>
              </Box>

              <Typography variant="caption" display="block" sx={{ mt: 3, textAlign: "center", color: "text.secondary" }}>
                The PDF will open in a new tab where you can view, download, or print it.
              </Typography>
            </Box>
          ) : (
            <Typography>Error generating PDF. Please try again.</Typography>
          )}
        </DialogContent>
        {!isGeneratingPdf && (
          <DialogActions>
            <Button onClick={() => setPdfDialogOpen(false)}>Close</Button>
            {pdfUrl && (
              <Button variant="outlined" startIcon={<PrintIcon />} onClick={handleDownloadPdf}>
                Open Again
              </Button>
            )}
          </DialogActions>
        )}
      </Dialog>
    </Box>
  );
}