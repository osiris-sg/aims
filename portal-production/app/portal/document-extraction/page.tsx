"use client";

import React, { useState, useCallback, useRef } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Stack,
  Alert,
  CircularProgress,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Paper,
  Divider,
  Grid,
  Chip,
} from "@mui/material";
import { CloudUpload, Description, CheckCircle, Error } from "@mui/icons-material";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { useOrganization } from "@hooks/useOrganization";

enum DocumentType {
  INVOICE = 'invoice',
  DELIVERY_ORDER = 'delivery_order',
  QUOTATION = 'quotation',
  PURCHASE_ORDER = 'purchase_order',
  RECEIPT = 'receipt',
}

const documentTypeLabels = {
  [DocumentType.INVOICE]: 'Invoice',
  [DocumentType.DELIVERY_ORDER]: 'Delivery Order',
  [DocumentType.QUOTATION]: 'Quotation',
  [DocumentType.PURCHASE_ORDER]: 'Purchase Order',
  [DocumentType.RECEIPT]: 'Receipt',
};

export default function DocumentExtractionPage() {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [documentType, setDocumentType] = useState<DocumentType>(DocumentType.INVOICE);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedData, setExtractedData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.match(/^image\//)) {
        setError("Please select an image file");
        return;
      }

      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        setError("File size must be less than 10MB");
        return;
      }

      setSelectedFile(file);
      setError(null);
      setExtractedData(null);
      setSuccess(false);

      // Create preview URL
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      // Create a synthetic event to reuse handleFileSelect logic
      const syntheticEvent = {
        target: { files: [file] }
      } as React.ChangeEvent<HTMLInputElement>;
      handleFileSelect(syntheticEvent);
    }
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const extractDocument = async () => {
    if (!selectedFile || !organization?.id) {
      setError("Please select a file and ensure you're logged in");
      return;
    }

    setIsExtracting(true);
    setError(null);
    setSuccess(false);

    try {
      const token = await getToken();
      if (!token) {
        throw new Error("Authentication token not available");
      }

      const formData = new FormData();
      formData.append("document", selectedFile);
      formData.append("documentType", documentType);

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4040'}/document-extraction/extract`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Failed to extract document");
      }

      setExtractedData(result.data);
      setSuccess(true);
    } catch (err: any) {
      console.error("Error extracting document:", err);
      setError(err.message || "Failed to extract document data");
    } finally {
      setIsExtracting(false);
    }
  };

  const resetForm = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setExtractedData(null);
    setError(null);
    setSuccess(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const renderExtractedData = () => {
    if (!extractedData) return null;

    return (
      <Box sx={{ mt: 3 }}>
        <Typography variant="h6" gutterBottom>
          Extracted Data
        </Typography>

        <Grid container spacing={2}>
          {/* Customer Information */}
          {extractedData.customer && (
            <Grid item xs={12} md={6}>
              <Paper elevation={1} sx={{ p: 2 }}>
                <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                  Customer Information
                </Typography>
                {extractedData.customer.name && (
                  <Typography variant="body2">
                    <strong>Name:</strong> {extractedData.customer.name}
                  </Typography>
                )}
                {extractedData.customer.address && (
                  <Typography variant="body2">
                    <strong>Address:</strong> {extractedData.customer.address}
                  </Typography>
                )}
                {extractedData.customer.attention && (
                  <Typography variant="body2">
                    <strong>Attention:</strong> {extractedData.customer.attention}
                  </Typography>
                )}
              </Paper>
            </Grid>
          )}

          {/* Document Details */}
          {extractedData.document && (
            <Grid item xs={12} md={6}>
              <Paper elevation={1} sx={{ p: 2 }}>
                <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                  Document Details
                </Typography>
                {extractedData.document.number && (
                  <Typography variant="body2">
                    <strong>Number:</strong> {extractedData.document.number}
                  </Typography>
                )}
                {extractedData.document.date && (
                  <Typography variant="body2">
                    <strong>Date:</strong> {extractedData.document.date}
                  </Typography>
                )}
                {extractedData.document.dueDate && (
                  <Typography variant="body2">
                    <strong>Due Date:</strong> {extractedData.document.dueDate}
                  </Typography>
                )}
              </Paper>
            </Grid>
          )}

          {/* References */}
          {extractedData.references && Object.keys(extractedData.references).some(key => extractedData.references[key]) && (
            <Grid item xs={12} md={6}>
              <Paper elevation={1} sx={{ p: 2 }}>
                <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                  References
                </Typography>
                {extractedData.references.doNumber && (
                  <Typography variant="body2">
                    <strong>DO Number:</strong> {extractedData.references.doNumber}
                  </Typography>
                )}
                {extractedData.references.quotationRef && (
                  <Typography variant="body2">
                    <strong>Quotation:</strong> {extractedData.references.quotationRef}
                  </Typography>
                )}
                {extractedData.references.workOrderNo && (
                  <Typography variant="body2">
                    <strong>Work Order:</strong> {extractedData.references.workOrderNo}
                  </Typography>
                )}
              </Paper>
            </Grid>
          )}

          {/* Project */}
          {extractedData.project && (extractedData.project.location || extractedData.project.projectDept) && (
            <Grid item xs={12} md={6}>
              <Paper elevation={1} sx={{ p: 2 }}>
                <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                  Project Information
                </Typography>
                {extractedData.project.location && (
                  <Typography variant="body2">
                    <strong>Location:</strong> {extractedData.project.location}
                  </Typography>
                )}
                {extractedData.project.projectDept && (
                  <Typography variant="body2">
                    <strong>Department:</strong> {extractedData.project.projectDept}
                  </Typography>
                )}
              </Paper>
            </Grid>
          )}

          {/* Items */}
          {extractedData.items && extractedData.items.length > 0 && (
            <Grid item xs={12}>
              <Paper elevation={1} sx={{ p: 2 }}>
                <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                  Items
                </Typography>
                <Box sx={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #ddd' }}>
                        <th style={{ padding: '8px', textAlign: 'left' }}>Description</th>
                        <th style={{ padding: '8px', textAlign: 'right' }}>Qty</th>
                        <th style={{ padding: '8px', textAlign: 'right' }}>Unit Price</th>
                        <th style={{ padding: '8px', textAlign: 'right' }}>Tax</th>
                        <th style={{ padding: '8px', textAlign: 'right' }}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {extractedData.items.map((item: any, index: number) => (
                        <tr key={index} style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '8px' }}>{item.description}</td>
                          <td style={{ padding: '8px', textAlign: 'right' }}>{item.quantity}</td>
                          <td style={{ padding: '8px', textAlign: 'right' }}>
                            {item.unitPrice?.toFixed(2)}
                          </td>
                          <td style={{ padding: '8px', textAlign: 'right' }}>{item.tax}%</td>
                          <td style={{ padding: '8px', textAlign: 'right' }}>
                            {item.amount?.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Box>
              </Paper>
            </Grid>
          )}

          {/* Totals */}
          {extractedData.totals && (
            <Grid item xs={12} md={4}>
              <Paper elevation={2} sx={{ p: 2, backgroundColor: 'primary.50' }}>
                <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                  Totals
                </Typography>
                {extractedData.totals.subtotal !== undefined && (
                  <Typography variant="body2">
                    <strong>Subtotal:</strong> ${extractedData.totals.subtotal.toFixed(2)}
                  </Typography>
                )}
                {extractedData.totals.tax !== undefined && (
                  <Typography variant="body2">
                    <strong>Tax:</strong> ${extractedData.totals.tax.toFixed(2)}
                  </Typography>
                )}
                {extractedData.totals.total !== undefined && (
                  <Typography variant="h6" color="primary" sx={{ mt: 1 }}>
                    <strong>Total:</strong> ${extractedData.totals.total.toFixed(2)}
                  </Typography>
                )}
              </Paper>
            </Grid>
          )}
        </Grid>

        {/* Raw JSON (collapsible) */}
        <Box sx={{ mt: 3 }}>
          <details>
            <summary style={{ cursor: 'pointer', padding: '8px' }}>
              <Typography variant="subtitle2" component="span">
                View Raw JSON Data
              </Typography>
            </summary>
            <Paper sx={{ p: 2, mt: 1, backgroundColor: '#f5f5f5' }}>
              <pre style={{ overflow: 'auto', fontSize: '12px' }}>
                {JSON.stringify(extractedData, null, 2)}
              </pre>
            </Paper>
          </details>
        </Box>
      </Box>
    );
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Document Data Extraction
      </Typography>
      <Typography variant="body1" color="text.secondary" gutterBottom>
        Upload a document image to automatically extract customer information, items, and other details using AI
      </Typography>

      <Grid container spacing={3} sx={{ mt: 2 }}>
        {/* Upload Section */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Stack spacing={3}>
                {/* Document Type Selection */}
                <FormControl fullWidth>
                  <InputLabel>Document Type</InputLabel>
                  <Select
                    value={documentType}
                    label="Document Type"
                    onChange={(e) => setDocumentType(e.target.value as DocumentType)}
                  >
                    {Object.entries(documentTypeLabels).map(([value, label]) => (
                      <MenuItem key={value} value={value}>
                        {label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                {/* File Upload Area */}
                <Paper
                  variant="outlined"
                  sx={{
                    p: 4,
                    textAlign: 'center',
                    backgroundColor: 'grey.50',
                    cursor: 'pointer',
                    '&:hover': {
                      backgroundColor: 'grey.100',
                    },
                  }}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleFileSelect}
                  />

                  {selectedFile ? (
                    <Stack alignItems="center" spacing={2}>
                      <CheckCircle color="success" sx={{ fontSize: 48 }} />
                      <Typography variant="body1">{selectedFile.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {(selectedFile.size / 1024).toFixed(2)} KB
                      </Typography>
                    </Stack>
                  ) : (
                    <Stack alignItems="center" spacing={2}>
                      <CloudUpload sx={{ fontSize: 48, color: 'primary.main' }} />
                      <Typography variant="body1">
                        Drop your document here or click to browse
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Supports: JPG, PNG, GIF, WebP, BMP (Max 10MB)
                      </Typography>
                    </Stack>
                  )}
                </Paper>

                {/* Action Buttons */}
                <Stack direction="row" spacing={2}>
                  <Button
                    variant="contained"
                    onClick={extractDocument}
                    disabled={!selectedFile || isExtracting}
                    startIcon={isExtracting ? <CircularProgress size={20} /> : <Description />}
                    fullWidth
                  >
                    {isExtracting ? 'Extracting...' : 'Extract Data'}
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={resetForm}
                    disabled={isExtracting}
                    fullWidth
                  >
                    Reset
                  </Button>
                </Stack>

                {/* Status Messages */}
                {error && (
                  <Alert severity="error" onClose={() => setError(null)}>
                    {error}
                  </Alert>
                )}
                {success && (
                  <Alert severity="success" onClose={() => setSuccess(false)}>
                    Document data extracted successfully!
                  </Alert>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Preview Section */}
        {previewUrl && (
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Document Preview
                </Typography>
                <Box
                  sx={{
                    width: '100%',
                    maxHeight: '500px',
                    overflow: 'auto',
                    border: '1px solid #ddd',
                    borderRadius: 1,
                    p: 1,
                  }}
                >
                  <img
                    src={previewUrl}
                    alt="Document preview"
                    style={{
                      width: '100%',
                      height: 'auto',
                      display: 'block',
                    }}
                  />
                </Box>
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>

      {/* Extracted Data Display */}
      {extractedData && renderExtractedData()}
    </Box>
  );
}