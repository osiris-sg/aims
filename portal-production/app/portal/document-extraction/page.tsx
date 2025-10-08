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
import DocumentExtractionForm from "./DocumentExtractionForm";

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
      // Validate file type (images and PDFs)
      if (!file.type.match(/^image\//) && file.type !== 'application/pdf') {
        setError("Please select an image or PDF file");
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

      // Create preview URL (only for images)
      if (file.type.match(/^image\//)) {
        const url = URL.createObjectURL(file);
        setPreviewUrl(url);
      } else {
        // For PDFs, clear preview
        setPreviewUrl(null);
      }
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

      console.log('Extraction API response FULL:', JSON.stringify(result, null, 2));
      console.log('result keys:', Object.keys(result));
      console.log('result.data:', result.data);
      console.log('result.data type:', typeof result.data);

      // The actual extracted data is nested inside result.data.data
      if (result.data && result.data.data) {
        console.log('result.data.data keys:', Object.keys(result.data.data));
        console.log('result.data.data.customer:', result.data.data.customer);
        console.log('result.data.data.items:', result.data.data.items);
        console.log('About to setExtractedData with:', result.data.data);
        setExtractedData(result.data.data);
        console.log('setExtractedData called successfully');
      } else {
        console.error('❌ result.data.data is undefined or null!');
        console.error('Full result:', result);
        setError('Failed to extract data from the response');
      }

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

  const handleSaveExtractedData = async (data: any) => {
    // TODO: Implement logic to create customer, project, items, and document records
    console.log('Saving extracted data:', data);

    // For now, just show a success message
    setSuccess(true);
    setError(null);

    // TODO: Add API calls to create:
    // 1. Customer (if not exists)
    // 2. Project (if not exists)
    // 3. Inventory items (if not exist)
    // 4. Document (Invoice/DO/etc)

    alert('Data saved successfully! (Not yet implemented - will create customer, project, items, and document records)');
  };

  const handleCancelEdit = () => {
    if (confirm('Are you sure you want to cancel? Any changes will be lost.')) {
      resetForm();
    }
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
                    accept="image/*,.pdf,application/pdf"
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
                        Supports: JPG, PNG, GIF, WebP, BMP, PDF (Max 10MB)
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
        {(previewUrl || (selectedFile && selectedFile.type === 'application/pdf')) && (
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
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt="Document preview"
                      style={{
                        width: '100%',
                        height: 'auto',
                        display: 'block',
                      }}
                    />
                  ) : (
                    <Stack alignItems="center" justifyContent="center" sx={{ minHeight: '300px' }}>
                      <Description sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                      <Typography variant="h6" color="text.secondary">
                        PDF Document Selected
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {selectedFile?.name}
                      </Typography>
                    </Stack>
                  )}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>

      {/* Extracted Data Form */}
      {extractedData && (
        <DocumentExtractionForm
          data={extractedData}
          onSave={handleSaveExtractedData}
          onCancel={handleCancelEdit}
        />
      )}
    </Box>
  );
}