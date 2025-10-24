import React, { useState, useEffect, useRef } from "react";
import DocumentNameHeader from "./DocumentNameHeader";
import { Alert, Box, Button, Card, CardContent, Grid2, Typography, useTheme, useMediaQuery, IconButton, TextField, Dialog, DialogTitle, DialogContent, DialogActions, Checkbox, FormControlLabel, Chip, Divider } from "@mui/material";
import { Close as CloseIcon, CameraAlt as CameraIcon, Edit as EditIcon, Comment as CommentIcon, Save as SaveIcon, Clear as ClearIcon, Receipt as InvoiceIcon, AttachMoney as MoneyIcon } from "@mui/icons-material";
import { useWatch } from "react-hook-form";
import TemplatePaper from "./TemplatePaper";
import FormInputBox from "@/form-components/FormInputBox";
import FormSelect from "@/form-components/FormSelect";
import DocumentCustomizer from "./DocumentCustomizer";
import useGetDocument from "../hooks/useGetDocument";
import DocumentSkeleton from "./DocumentSkeleton";
import usePrintDocumentHandler from "../hooks/usePrintDocumentHandler";
import { useParams, usePathname, useRouter } from "next/navigation";
import useMSRTemplateHandler from "../hooks/useMSRTemplateHandler";
import useMSRDocumentCreator from "../hooks/useMSRDocumentCreator";
import WebcamComponent from "./WebCam";
import Image from "next/image";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { toast } from "react-toastify";

interface Props {
  viewMode: boolean;
}

// Interface for annotated photos
interface AnnotatedPhoto {
  id: string;
  imageData: string; // base64 or S3 URL
  annotations?: string; // SVG drawing data
  partName: string; // Name/title of the part being photographed
  comments: string;
  timestamp: number;
  // Chargeable part fields
  isChargeable?: boolean;
  unitPrice?: number;
  quantity?: number;
  laborHours?: number;
  laborRate?: number;
}

// Document type for MSR
interface MSRDocument {
  config?: {
    photos?: AnnotatedPhoto[];
    reportDetails?: {
      equipmentId?: string;
      location?: string;
      reportType?: string;
      description?: string;
    };
  };
}

export default function MaintenanceServiceReportTemplate(props: Props) {
  const { documentId } = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const isEditPath = pathname.includes("edit");
  const { viewMode = false } = props;
  const [isViewMode, toggleViewMode] = useState(viewMode);
  const [isToolBarOpen, toggleToolbar] = useState(false);
  const { isDocumentLoading, document } = useGetDocument();
  const { methods, onSubmit, editableVisibilityFields, isLoading, isDirty, errors } = useMSRTemplateHandler();
  const { control, setValue, onDocumentCreate, onSubmitWithStatus, isLoading: isDocumentCreationloading, isDirty: isDCretorDisabled, isFormReadyForSubmission } = useMSRDocumentCreator();
  const { contentRef, handlePrint } = usePrintDocumentHandler();
  const { getToken } = useAuth();
  const { organization } = useOrganization();

  // MSR-specific state
  const [isWebcamOpen, setWebcamOpen] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [isCommentMode, setIsCommentMode] = useState(false);
  const [tempComment, setTempComment] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // New states for photo capture flow
  const [isPhotoDetailsDialogOpen, setIsPhotoDetailsDialogOpen] = useState(false);
  const [capturedImageData, setCapturedImageData] = useState<string>("");
  const [tempPartName, setTempPartName] = useState("");
  const [tempPhotoComment, setTempPhotoComment] = useState("");

  // Chargeable part states
  const [tempIsChargeable, setTempIsChargeable] = useState(false);
  const [tempUnitPrice, setTempUnitPrice] = useState<number>(0);
  const [tempQuantity, setTempQuantity] = useState<number>(1);
  const [tempLaborHours, setTempLaborHours] = useState<number>(0);
  const [tempLaborRate, setTempLaborRate] = useState<number>(0);

  // Invoice creation state
  const [isCreatingInvoice, setIsCreatingInvoice] = useState(false);
  const [invoiceConfirmDialogOpen, setInvoiceConfirmDialogOpen] = useState(false);
  const [invoicePreviewData, setInvoicePreviewData] = useState<{
    chargeablePhotos: AnnotatedPhoto[];
    totalParts: number;
    totalLabor: number;
    grandTotal: number;
  } | null>(null);

  // Mobile responsiveness
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  // Watch for photos in form state
  const photos = useWatch({ control, name: "photos" }) || [];
  const reportDetails = useWatch({ control, name: "reportDetails" }) || {};

  // Handle status-based document submission
  const handleSubmitWithStatus = (status: string) => {
    console.log("Submitting MSR with status:", status);
    onSubmitWithStatus(status);
  };

  // Handle create invoice from chargeable parts
  const handleCreateInvoice = async () => {
    const chargeablePhotos = photos.filter((photo: AnnotatedPhoto) => photo.isChargeable);

    if (chargeablePhotos.length === 0) {
      toast.error("No chargeable parts found. Please mark some parts as chargeable first.");
      return;
    }

    // Auto-save MSR document first to ensure all changes are persisted
    if (documentId && isDCretorDisabled) {
      // isDCretorDisabled is actually isDirty from MSR document creator
      toast.info("Saving MSR changes before creating invoice...");
      try {
        await onDocumentCreate(); // Save the current MSR document
        toast.success("MSR saved successfully!");
        // Wait a moment for the save to complete
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        console.error("Error saving MSR:", error);
        toast.error("Failed to save MSR. Please save manually before creating invoice.");
        return;
      }
    }

    // Calculate totals for confirmation
    const totalParts = chargeablePhotos.reduce((sum: number, photo: AnnotatedPhoto) => {
      return sum + (photo.unitPrice || 0) * (photo.quantity || 1);
    }, 0);

    const totalLabor = chargeablePhotos.reduce((sum: number, photo: AnnotatedPhoto) => {
      return sum + (photo.laborHours || 0) * (photo.laborRate || 0);
    }, 0);

    const grandTotal = totalParts + totalLabor;

    // Set preview data and open dialog
    setInvoicePreviewData({
      chargeablePhotos,
      totalParts,
      totalLabor,
      grandTotal,
    });
    setInvoiceConfirmDialogOpen(true);
  };

  // Handle confirmed invoice creation
  const handleConfirmInvoiceCreation = async () => {
    if (!invoicePreviewData) return;

    const { chargeablePhotos } = invoicePreviewData;

    setIsCreatingInvoice(true);
    setInvoiceConfirmDialogOpen(false);
    toast.info("Creating invoice from MSR...");

    try {
      const token = await getToken();
      if (!token) {
        toast.error("Authentication required");
        return;
      }

      // First, get the invoice document template ID
      const templateResponse = await request(
        {
          path: "/documentTemplates/type/TI",
          method: "GET",
        },
        {},
        token
      );

      if (!templateResponse?.data?.id) {
        toast.error("Invoice template not found");
        return;
      }

      const documentTemplateId = templateResponse.data.id;

      // Convert MSR items to invoice items format - match exact structure expected by invoice
      const invoiceItems = chargeablePhotos.map((photo: AnnotatedPhoto) => ({
        inventoryItemId: "", // Empty string instead of null
        description: `${photo.partName} - ${photo.comments || "Maintenance service"}`,
        quantity: String(photo.quantity || 1),
        price: String(photo.unitPrice || 0),
        tax: "0",
        customTax: "", // Add customTax field
      }));

      // Add labor as separate items
      const laborItems = chargeablePhotos
        .filter((photo: AnnotatedPhoto) => photo.laborHours && photo.laborRate)
        .map((photo: AnnotatedPhoto) => ({
          inventoryItemId: "", // Empty string instead of null
          description: `Labor: ${photo.partName}`,
          quantity: String(photo.laborHours || 0),
          price: String(photo.laborRate || 0),
          tax: "0",
          customTax: "", // Add customTax field
        }));

      const config = {
        items: [...invoiceItems, ...laborItems],
        msrSource: {
          sourceId: (document as any)?.id,
          reportDetails: reportDetails,
        },
      };

      console.log("MSR Invoice Config being sent:", JSON.stringify(config, null, 2));
      console.log("Invoice items structure:", invoiceItems);
      console.log("Labor items structure:", laborItems);

      // Create the invoice document
      const createResponse = await request(
        {
          path: "/documents/basic",
          method: "POST",
        },
        {
          type: "TI",
          config: config,
          documentTemplateId: documentTemplateId,
          organizationId: organization?.id,
        },
        token
      );

      console.log("Invoice creation response:", createResponse);

      if (createResponse?.data?.id) {
        const createdDocumentId = createResponse.data.id;

        // Update MSR document to mark it as invoiced
        if (documentId) {
          try {
            await request(
              {
                path: "/documents/update",
                method: "POST",
              },
              {
                id: documentId,
                type: (document as any)?.type,
                config: {
                  ...reportDetails,
                  photos: photos,
                  invoiceCreated: true,
                  invoiceId: createdDocumentId,
                  invoiceCreatedAt: new Date().toISOString(),
                },
                status: "invoiced", // Update status to invoiced
              },
              token
            );
            console.log("MSR document updated with invoice information");
          } catch (updateError) {
            console.error("Error updating MSR document:", updateError);
            // Don't fail the whole process if MSR update fails
          }
        }

        toast.success("Invoice created successfully! MSR updated.");

        // Navigate to the created invoice
        const invoiceUrl = `/portal/documents/TI/${documentTemplateId}/${createdDocumentId}`;
        window.open(invoiceUrl, "_blank");
      } else {
        toast.error("Failed to create invoice");
      }
    } catch (error) {
      console.error("Error creating invoice:", error);
      toast.error("An error occurred while creating the invoice");
    } finally {
      setIsCreatingInvoice(false);
    }
  };

  // Handle loading photos from existing document
  useEffect(() => {
    const msrDoc = document as MSRDocument;
    if (documentId && msrDoc?.config?.photos) {
      setValue("photos", msrDoc.config.photos, { shouldDirty: false });
    }
    if (documentId && msrDoc?.config?.reportDetails) {
      setValue("reportDetails", msrDoc.config.reportDetails, { shouldDirty: false });
    }
  }, [documentId, document, setValue]);

  // Drawing functions
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingMode || !canvasRef.current) return;
    setIsDrawing(true);
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.strokeStyle = "#ff0000";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    }
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !isDrawingMode || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
      ctx.stroke();
    }
  };

  const stopDrawing = () => {
    if (!isDrawingMode) return;
    setIsDrawing(false);
    // Save drawing data
    if (canvasRef.current && selectedPhotoIndex !== null) {
      const drawingData = canvasRef.current.toDataURL();
      const updatedPhotos = [...photos];
      updatedPhotos[selectedPhotoIndex] = {
        ...updatedPhotos[selectedPhotoIndex],
        annotations: drawingData,
      };
      setValue("photos", updatedPhotos, { shouldDirty: true });

      console.log("Saved MSR annotation for photo:", {
        photoIndex: selectedPhotoIndex,
        partName: updatedPhotos[selectedPhotoIndex]?.partName,
        annotationLength: drawingData.length,
      });
    }
  };

  const clearDrawing = () => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  // Photo management functions
  const handlePhotoCapture = (imageData: string) => {
    // Store captured image and open details dialog
    setCapturedImageData(imageData);
    setWebcamOpen(false);
    setIsPhotoDetailsDialogOpen(true);
    setTempPartName("");
    setTempPhotoComment("");
  };

  const handleSavePhotoDetails = () => {
    if (!tempPartName.trim()) return;

    const newPhoto: AnnotatedPhoto = {
      id: Date.now().toString(),
      imageData: capturedImageData,
      partName: tempPartName.trim(),
      comments: tempPhotoComment.trim(),
      timestamp: Date.now(),
      isChargeable: tempIsChargeable,
      unitPrice: tempIsChargeable ? tempUnitPrice : undefined,
      quantity: tempIsChargeable ? tempQuantity : undefined,
      laborHours: tempIsChargeable ? tempLaborHours : undefined,
      laborRate: tempIsChargeable ? tempLaborRate : undefined,
    };
    const updatedPhotos = [...photos, newPhoto];
    setValue("photos", updatedPhotos, { shouldDirty: true });

    console.log("Added new MSR photo:", {
      partName: newPhoto.partName,
      imageDataLength: newPhoto.imageData.length,
      isChargeable: newPhoto.isChargeable,
      totalPhotos: updatedPhotos.length,
    });

    // Reset states
    setIsPhotoDetailsDialogOpen(false);
    setCapturedImageData("");
    setTempPartName("");
    setTempPhotoComment("");
    setTempIsChargeable(false);
    setTempUnitPrice(0);
    setTempQuantity(1);
    setTempLaborHours(0);
    setTempLaborRate(0);
  };

  const handleCancelPhotoDetails = () => {
    setIsPhotoDetailsDialogOpen(false);
    setCapturedImageData("");
    setTempPartName("");
    setTempPhotoComment("");
    setTempIsChargeable(false);
    setTempUnitPrice(0);
    setTempQuantity(1);
    setTempLaborHours(0);
    setTempLaborRate(0);
  };

  const handleDeletePhoto = (index: number) => {
    const updatedPhotos = photos.filter((_: AnnotatedPhoto, i: number) => i !== index);
    setValue("photos", updatedPhotos, { shouldDirty: true });
    if (selectedPhotoIndex === index) {
      setSelectedPhotoIndex(null);
      setIsDrawingMode(false);
      setIsCommentMode(false);
    }
  };

  const handleSaveComment = () => {
    if (selectedPhotoIndex !== null && tempComment.trim()) {
      const updatedPhotos = [...photos];
      updatedPhotos[selectedPhotoIndex] = {
        ...updatedPhotos[selectedPhotoIndex],
        comments: tempComment.trim(),
      };
      setValue("photos", updatedPhotos, { shouldDirty: true });
      setTempComment("");
      setIsCommentMode(false);
    }
  };

  const handleSelectPhoto = (index: number) => {
    setSelectedPhotoIndex(index);
    setIsDrawingMode(false);
    setIsCommentMode(false);
    setTempComment(photos[index]?.comments || "");

    // Load existing annotation if available
    if (photos[index]?.annotations && canvasRef.current) {
      const img = new window.Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          }
        }
      };
      img.src = photos[index].annotations.startsWith("data:image") ? photos[index].annotations : `${process.env.NEXT_PUBLIC_RESOURCE_URL || "https://aims-osiris.s3.ap-southeast-1.amazonaws.com/"}${photos[index].annotations}`;
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", gap: "var(--default-gap)", overflow: "hidden" }}>
      <DocumentNameHeader
        primaryActionLoading={isLoading}
        secondaryActionLoading={isDocumentCreationloading}
        title="Maintenance Service Report"
        description="Capture photos, annotate, and comment for maintenance documentation"
        viewMode={isViewMode}
        toggleViewMode={(value) => toggleViewMode(value)}
        onPrimaryActionSubmit={onSubmit}
        onSecondaryActionSubmit={onDocumentCreate}
        primaryActionDisabled={!isDirty}
        secondaryActionDisabled={!isDCretorDisabled || isDirty}
        onPrint={handlePrint}
        documentEditMode={!!documentId}
        isEditPath={isEditPath}
        isFormReadyForSubmission={isFormReadyForSubmission}
        onSubmitWithStatus={handleSubmitWithStatus}
        documentStatus={document?.status}
        currentDocumentId={(document as any)?.id}
      />
      <Grid2 container spacing={1} height="100%">
        {!documentId && isToolBarOpen && (
          <Grid2 size={3}>
            <form onSubmit={onSubmit}>
              <DocumentCustomizer fields={editableVisibilityFields} control={methods.control} />
            </form>
          </Grid2>
        )}
        <Grid2 size={!documentId && isToolBarOpen ? 9 : 12} height="100%">
          <TemplatePaper isToolBarOpen={isToolBarOpen} toggleToolbar={() => toggleToolbar(!isToolBarOpen)} documentEditMode={!!documentId}>
            {isDocumentLoading ? (
              <DocumentSkeleton />
            ) : (
              <>
                <form onSubmit={onSubmit} ref={contentRef}>
                  <Box
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      padding: isMobile ? "var(--default-gap)" : "var(--double-gap)",
                      gap: isMobile ? "var(--default-gap)" : "var(--double-gap)",
                    }}
                  >
                    {/* Document Title */}
                    <Box sx={{ textAlign: "center", mb: 3 }}>
                      <Typography variant={isMobile ? "h5" : "h4"} sx={{ fontWeight: 600 }}>
                        Maintenance Service Report
                      </Typography>
                    </Box>

                    {/* Report Details Section */}
                    <Card sx={{ mb: 3 }}>
                      <CardContent>
                        <Typography variant="h6" sx={{ mb: 2 }}>
                          Report Details
                        </Typography>
                        <Grid2 container spacing={isMobile ? 3 : 2}>
                          <Grid2 size={isMobile ? 12 : 6}>
                            <FormInputBox control={control} name="reportDetails.equipmentId" label="Equipment ID" placeHolder="Enter Equipment ID" size="small" viewMode={isViewMode} labelArriangment={isViewMode ? "horizontal" : "vertical"} />
                          </Grid2>
                          <Grid2 size={isMobile ? 12 : 6}>
                            <FormInputBox control={control} name="reportDetails.location" label="Location" placeHolder="Enter Location" size="small" viewMode={isViewMode} labelArriangment={isViewMode ? "horizontal" : "vertical"} />
                          </Grid2>
                          <Grid2 size={isMobile ? 12 : 6}>
                            <FormSelect
                              control={control}
                              name="reportDetails.reportType"
                              label="Report Type"
                              menuTitle="Select report type"
                              menuItems={[
                                { label: "Preventive Maintenance", value: "preventive" },
                                { label: "Corrective Maintenance", value: "corrective" },
                                { label: "Emergency Repair", value: "emergency" },
                                { label: "Inspection", value: "inspection" },
                              ]}
                              size="small"
                              viewMode={isViewMode}
                              labelArriangment={isViewMode ? "horizontal" : "vertical"}
                            />
                          </Grid2>
                          <Grid2 size={isMobile ? 12 : 6}>
                            <FormInputBox control={control} name="reportDetails.date" label="Service Date" type="date" size="small" viewMode={isViewMode} labelArriangment={isViewMode ? "horizontal" : "vertical"} />
                          </Grid2>
                          <Grid2 size={12}>
                            <TextField
                              fullWidth
                              multiline
                              rows={isMobile ? 2 : 3}
                              label="Description"
                              placeholder="Enter detailed description of the maintenance work..."
                              value={reportDetails.description || ""}
                              onChange={(e) => setValue("reportDetails.description", e.target.value, { shouldDirty: true })}
                              disabled={isViewMode}
                              size="small"
                            />
                          </Grid2>
                        </Grid2>
                      </CardContent>
                    </Card>

                    {/* Photo Documentation Section */}
                    <Card>
                      <CardContent>
                        <Box
                          sx={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: isMobile ? "flex-start" : "center",
                            mb: 2,
                            flexDirection: isMobile ? "column" : "row",
                            gap: isMobile ? 1 : 0,
                          }}
                        >
                          <Typography variant="h6">Photo Documentation</Typography>
                          <Box sx={{ display: "flex", gap: 1, flexDirection: isMobile ? "column" : "row" }}>
                            {!isViewMode && (
                              <Button variant="contained" startIcon={<CameraIcon />} onClick={() => setWebcamOpen(true)} size="small" fullWidth={isMobile}>
                                Take Photo
                              </Button>
                            )}
                            {photos.some((photo: AnnotatedPhoto) => photo.isChargeable) && (
                              <Button variant="outlined" startIcon={<InvoiceIcon />} onClick={handleCreateInvoice} size="small" fullWidth={isMobile} color="success" disabled={isCreatingInvoice} loading={isCreatingInvoice}>
                                {isCreatingInvoice ? "Creating..." : "Create Invoice"}
                              </Button>
                            )}
                          </Box>
                        </Box>

                        {photos.length === 0 ? (
                          <Box sx={{ textAlign: "center", py: 4, color: "text.secondary" }}>
                            <CameraIcon sx={{ fontSize: "3rem", mb: 1, opacity: 0.5 }} />
                            <Typography>No photos captured yet</Typography>
                            <Typography variant="body2">Click &quot;Take Photo&quot; to start documenting</Typography>
                          </Box>
                        ) : (
                          <Grid2 container spacing={isMobile ? 3 : 2}>
                            {photos.map((photo: AnnotatedPhoto, index: number) => (
                              <Grid2 key={photo.id} size={isMobile ? 12 : 6}>
                                <Card
                                  sx={{
                                    cursor: "pointer",
                                    border: selectedPhotoIndex === index ? 2 : 1,
                                    borderColor: selectedPhotoIndex === index ? "primary.main" : "grey.300",
                                    position: "relative",
                                  }}
                                  onClick={() => handleSelectPhoto(index)}
                                >
                                  {/* Delete Button */}
                                  {!isViewMode && (
                                    <IconButton
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeletePhoto(index);
                                      }}
                                      sx={{
                                        position: "absolute",
                                        top: 8,
                                        right: 8,
                                        backgroundColor: "rgba(255, 255, 255, 0.9)",
                                        color: "error.main",
                                        zIndex: 2,
                                        width: 32,
                                        height: 32,
                                      }}
                                      size="small"
                                    >
                                      <CloseIcon fontSize="small" />
                                    </IconButton>
                                  )}

                                  <Box sx={{ position: "relative" }}>
                                    <Image
                                      src={photo.imageData.startsWith("data:image") ? photo.imageData : `${process.env.NEXT_PUBLIC_RESOURCE_URL || "https://aims-osiris.s3.ap-southeast-1.amazonaws.com/"}${photo.imageData}`}
                                      alt={`Photo ${index + 1}`}
                                      width={isMobile ? 300 : 400}
                                      height={isMobile ? 200 : 300}
                                      style={{
                                        width: "100%",
                                        height: isMobile ? "180px" : "200px",
                                        objectFit: "cover",
                                      }}
                                    />

                                    {/* Annotation overlay */}
                                    {photo.annotations && (
                                      <Box
                                        sx={{
                                          position: "absolute",
                                          top: 0,
                                          left: 0,
                                          width: "100%",
                                          height: "100%",
                                          backgroundImage: `url(${photo.annotations.startsWith("data:image") ? photo.annotations : `${process.env.NEXT_PUBLIC_RESOURCE_URL || "https://aims-osiris.s3.ap-southeast-1.amazonaws.com/"}${photo.annotations}`})`,
                                          backgroundSize: "cover",
                                          pointerEvents: "none",
                                        }}
                                      />
                                    )}
                                  </Box>

                                  <CardContent sx={{ pt: 1 }}>
                                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 1 }}>
                                      <Typography variant="body2" sx={{ fontWeight: 600, color: "primary.main" }}>
                                        {photo.partName || `Photo ${index + 1}`}
                                      </Typography>
                                      {photo.isChargeable && <Chip icon={<MoneyIcon />} label="Chargeable" size="small" color="success" variant="outlined" />}
                                    </Box>
                                    {photo.comments && (
                                      <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.875rem", fontStyle: "italic", mb: 1 }}>
                                        &quot;{photo.comments}&quot;
                                      </Typography>
                                    )}
                                    {photo.isChargeable && (
                                      <Box sx={{ mb: 1 }}>
                                        <Typography variant="caption" color="success.main" sx={{ display: "block" }}>
                                          Parts: ${((photo.unitPrice || 0) * (photo.quantity || 1)).toFixed(2)}
                                          {photo.laborHours && photo.laborRate && <> | Labor: ${((photo.laborHours || 0) * (photo.laborRate || 0)).toFixed(2)}</>}
                                        </Typography>
                                      </Box>
                                    )}
                                    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                                      {new Date(photo.timestamp).toLocaleString()}
                                    </Typography>
                                  </CardContent>
                                </Card>
                              </Grid2>
                            ))}
                          </Grid2>
                        )}

                        {/* Photo Editing Panel */}
                        {selectedPhotoIndex !== null && !isViewMode && (
                          <Box sx={{ mt: 3, p: isMobile ? 1.5 : 2, backgroundColor: "grey.50", borderRadius: 1 }}>
                            <Typography variant={isMobile ? "body1" : "h6"} sx={{ mb: 2, fontWeight: 600 }}>
                              Edit: {photos[selectedPhotoIndex]?.partName || `Photo ${selectedPhotoIndex + 1}`}
                            </Typography>

                            <Box
                              sx={{
                                display: "flex",
                                gap: 1,
                                mb: 2,
                                flexWrap: "wrap",
                                flexDirection: isMobile ? "column" : "row",
                              }}
                            >
                              <Button
                                variant={isDrawingMode ? "contained" : "outlined"}
                                startIcon={<EditIcon />}
                                onClick={() => {
                                  setIsDrawingMode(!isDrawingMode);
                                  setIsCommentMode(false);
                                }}
                                size="small"
                                fullWidth={isMobile}
                              >
                                Draw
                              </Button>
                              <Button
                                variant={isCommentMode ? "contained" : "outlined"}
                                startIcon={<CommentIcon />}
                                onClick={() => {
                                  setIsCommentMode(!isCommentMode);
                                  setIsDrawingMode(false);
                                  setTempComment(photos[selectedPhotoIndex]?.comments || "");
                                }}
                                size="small"
                                fullWidth={isMobile}
                              >
                                Edit Comment
                              </Button>
                              {isDrawingMode && (
                                <Button variant="outlined" startIcon={<ClearIcon />} onClick={clearDrawing} size="small" color="error" fullWidth={isMobile}>
                                  Clear Drawing
                                </Button>
                              )}
                            </Box>

                            {/* Drawing Canvas */}
                            {isDrawingMode && (
                              <Box sx={{ position: "relative", mb: 2, width: "100%" }}>
                                <canvas
                                  ref={canvasRef}
                                  width={isMobile ? 300 : 400}
                                  height={isMobile ? 200 : 300}
                                  onMouseDown={startDrawing}
                                  onMouseMove={draw}
                                  onMouseUp={stopDrawing}
                                  onMouseLeave={stopDrawing}
                                  style={{
                                    border: "2px solid #1976d2",
                                    borderRadius: "4px",
                                    cursor: "crosshair",
                                    width: "100%",
                                    maxWidth: isMobile ? "300px" : "400px",
                                  }}
                                />
                              </Box>
                            )}

                            {/* Comment Input */}
                            {isCommentMode && (
                              <Box sx={{ mb: 2 }}>
                                <TextField fullWidth multiline rows={isMobile ? 2 : 3} label="Update Comment" placeholder="Describe the condition, issue, or observation..." value={tempComment} onChange={(e) => setTempComment(e.target.value)} size="small" />
                                <Box
                                  sx={{
                                    mt: 1,
                                    display: "flex",
                                    gap: 1,
                                    flexDirection: isMobile ? "column" : "row",
                                  }}
                                >
                                  <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSaveComment} size="small" disabled={!tempComment.trim()} fullWidth={isMobile}>
                                    Save Comment
                                  </Button>
                                  <Button
                                    variant="outlined"
                                    onClick={() => {
                                      setIsCommentMode(false);
                                      setTempComment(photos[selectedPhotoIndex]?.comments || "");
                                    }}
                                    size="small"
                                    fullWidth={isMobile}
                                  >
                                    Cancel
                                  </Button>
                                </Box>
                              </Box>
                            )}
                          </Box>
                        )}
                      </CardContent>
                    </Card>

                    {/* Validation Errors Display */}
                    {Object.keys(errors || {}).length > 0 && (
                      <Alert severity="error" sx={{ mt: 2 }}>
                        <Typography variant="body2" sx={{ fontWeight: "bold", mb: 1 }}>
                          Form Validation Errors:
                        </Typography>
                        <pre style={{ fontSize: "0.75rem", margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(errors, null, 2)}</pre>
                      </Alert>
                    )}
                  </Box>
                </form>

                {/* Webcam Dialog */}
                <Dialog open={isWebcamOpen} onClose={() => setWebcamOpen(false)} maxWidth="md" fullWidth fullScreen={isMobile}>
                  <DialogTitle>Capture Photo</DialogTitle>
                  <DialogContent>
                    <WebcamComponent onCapture={handlePhotoCapture} />
                  </DialogContent>
                  <DialogActions>
                    <Button onClick={() => setWebcamOpen(false)} fullWidth={isMobile}>
                      Cancel
                    </Button>
                  </DialogActions>
                </Dialog>

                {/* Photo Details Dialog */}
                <Dialog open={isPhotoDetailsDialogOpen} onClose={handleCancelPhotoDetails} maxWidth="sm" fullWidth fullScreen={isMobile}>
                  <DialogTitle>Add Photo Details</DialogTitle>
                  <DialogContent sx={{ pt: 2 }}>
                    {/* Photo Preview */}
                    {capturedImageData && (
                      <Box sx={{ mb: 3, textAlign: "center" }}>
                        <Box
                          sx={{
                            position: "relative",
                            display: "inline-block",
                            maxWidth: "100%",
                            maxHeight: isMobile ? "150px" : "200px",
                            borderRadius: "8px",
                            border: "1px solid #ddd",
                            overflow: "hidden",
                          }}
                        >
                          <Image
                            src={capturedImageData}
                            alt="Captured"
                            width={isMobile ? 200 : 300}
                            height={isMobile ? 150 : 200}
                            style={{
                              width: "auto",
                              height: "auto",
                              maxWidth: "100%",
                              maxHeight: isMobile ? "150px" : "200px",
                              borderRadius: "8px",
                            }}
                          />
                        </Box>
                      </Box>
                    )}

                    {/* Part Name Input */}
                    <TextField fullWidth label="Part Name" placeholder="e.g., Engine Block, Brake Disc, Control Panel..." value={tempPartName} onChange={(e) => setTempPartName(e.target.value)} sx={{ mb: 2 }} size="small" required />

                    {/* Comments Input */}
                    <TextField fullWidth multiline rows={isMobile ? 2 : 3} label="Comments (Optional)" placeholder="Describe the condition, issue, or observation..." value={tempPhotoComment} onChange={(e) => setTempPhotoComment(e.target.value)} size="small" />

                    {/* Chargeable Part Section */}
                    <Box sx={{ mt: 3, p: 2, backgroundColor: "grey.50", borderRadius: 1 }}>
                      <FormControlLabel control={<Checkbox checked={tempIsChargeable} onChange={(e) => setTempIsChargeable(e.target.checked)} color="success" />} label="This is a chargeable part/service" />

                      {tempIsChargeable && (
                        <Box sx={{ mt: 2, display: "flex", flexDirection: "column", gap: 2 }}>
                          <Typography variant="subtitle2" color="success.main" sx={{ fontWeight: 600 }}>
                            Pricing Details
                          </Typography>

                          <Box sx={{ display: "flex", gap: 2, flexDirection: isMobile ? "column" : "row" }}>
                            <TextField label="Unit Price ($)" type="number" value={tempUnitPrice} onChange={(e) => setTempUnitPrice(Number(e.target.value))} size="small" fullWidth={isMobile} inputProps={{ min: 0, step: 0.01 }} />
                            <TextField label="Quantity" type="number" value={tempQuantity} onChange={(e) => setTempQuantity(Number(e.target.value))} size="small" fullWidth={isMobile} inputProps={{ min: 1, step: 1 }} />
                          </Box>

                          <Box sx={{ display: "flex", gap: 2, flexDirection: isMobile ? "column" : "row" }}>
                            <TextField label="Labor Hours" type="number" value={tempLaborHours} onChange={(e) => setTempLaborHours(Number(e.target.value))} size="small" fullWidth={isMobile} inputProps={{ min: 0, step: 0.5 }} />
                            <TextField label="Labor Rate ($/hr)" type="number" value={tempLaborRate} onChange={(e) => setTempLaborRate(Number(e.target.value))} size="small" fullWidth={isMobile} inputProps={{ min: 0, step: 0.01 }} />
                          </Box>

                          <Box sx={{ p: 1, backgroundColor: "success.50", borderRadius: 1, border: "1px solid", borderColor: "success.200" }}>
                            <Typography variant="body2" color="success.main" sx={{ fontWeight: 600 }}>
                              Total: ${(tempUnitPrice * tempQuantity + tempLaborHours * tempLaborRate).toFixed(2)}
                              <Typography component="span" variant="caption" sx={{ ml: 1, fontWeight: 400 }}>
                                (Parts: ${(tempUnitPrice * tempQuantity).toFixed(2)} + Labor: ${(tempLaborHours * tempLaborRate).toFixed(2)})
                              </Typography>
                            </Typography>
                          </Box>
                        </Box>
                      )}
                    </Box>
                  </DialogContent>
                  <DialogActions
                    sx={{
                      flexDirection: isMobile ? "column" : "row",
                      gap: isMobile ? 1 : 0,
                      p: isMobile ? 2 : 1,
                    }}
                  >
                    <Button onClick={handleCancelPhotoDetails} color="secondary" fullWidth={isMobile}>
                      Cancel
                    </Button>
                    <Button onClick={handleSavePhotoDetails} variant="contained" disabled={!tempPartName.trim()} fullWidth={isMobile}>
                      Save Photo
                    </Button>
                  </DialogActions>
                </Dialog>

                {/* Invoice Confirmation Dialog */}
                <Dialog open={invoiceConfirmDialogOpen} onClose={() => setInvoiceConfirmDialogOpen(false)} maxWidth="sm" fullWidth fullScreen={isMobile}>
                  <DialogTitle>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <InvoiceIcon color="success" />
                      Create Invoice from MSR
                    </Box>
                  </DialogTitle>
                  <DialogContent sx={{ pt: 2 }}>
                    {invoicePreviewData && (
                      <>
                        <Typography variant="body1" sx={{ mb: 2 }}>
                          Create invoice for <strong>{invoicePreviewData.chargeablePhotos.length}</strong> chargeable items?
                        </Typography>

                        {/* Items Summary */}
                        <Box sx={{ mb: 3 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                            Chargeable Items:
                          </Typography>
                          {invoicePreviewData.chargeablePhotos.map((photo, index) => (
                            <Box key={photo.id} sx={{ mb: 1, p: 1, backgroundColor: "grey.50", borderRadius: 1 }}>
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                {photo.partName}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                Qty: {photo.quantity} × ${photo.unitPrice?.toFixed(2)} = ${((photo.unitPrice || 0) * (photo.quantity || 1)).toFixed(2)}
                              </Typography>
                              {photo.laborHours && photo.laborRate && (
                                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                                  Labor: {photo.laborHours}hrs × ${photo.laborRate?.toFixed(2)}/hr = ${((photo.laborHours || 0) * (photo.laborRate || 0)).toFixed(2)}
                                </Typography>
                              )}
                            </Box>
                          ))}
                        </Box>

                        <Divider sx={{ my: 2 }} />

                        {/* Totals */}
                        <Box sx={{ mb: 2 }}>
                          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                            <Typography variant="body2">Parts Total:</Typography>
                            <Typography variant="body2">${invoicePreviewData.totalParts.toFixed(2)}</Typography>
                          </Box>
                          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                            <Typography variant="body2">Labor Total:</Typography>
                            <Typography variant="body2">${invoicePreviewData.totalLabor.toFixed(2)}</Typography>
                          </Box>
                          <Divider sx={{ my: 1 }} />
                          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                            <Typography variant="h6" sx={{ fontWeight: 600 }}>
                              Grand Total:
                            </Typography>
                            <Typography variant="h6" sx={{ fontWeight: 600, color: "success.main" }}>
                              ${invoicePreviewData.grandTotal.toFixed(2)}
                            </Typography>
                          </Box>
                        </Box>

                        <Alert severity="info" sx={{ mt: 2 }}>
                          <Typography variant="body2">This will create an invoice and automatically update this MSR document status to "invoiced".</Typography>
                        </Alert>
                      </>
                    )}
                  </DialogContent>
                  <DialogActions
                    sx={{
                      flexDirection: isMobile ? "column" : "row",
                      gap: isMobile ? 1 : 0,
                      p: isMobile ? 2 : 1,
                    }}
                  >
                    <Button onClick={() => setInvoiceConfirmDialogOpen(false)} color="secondary" fullWidth={isMobile} disabled={isCreatingInvoice}>
                      Cancel
                    </Button>
                    <Button onClick={handleConfirmInvoiceCreation} variant="contained" color="success" fullWidth={isMobile} disabled={isCreatingInvoice} startIcon={<InvoiceIcon />}>
                      {isCreatingInvoice ? "Creating..." : "Create Invoice"}
                    </Button>
                  </DialogActions>
                </Dialog>
              </>
            )}
          </TemplatePaper>
        </Grid2>
      </Grid2>
    </Box>
  );
}
