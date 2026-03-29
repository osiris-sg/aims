"use client";

import React from "react";
import { Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from "@mui/material";

// Font handling:
// - Using Carlito from Google Fonts (open-source, metric-compatible with Calibri)
// - Fallback chain: Carlito → Calibri (if installed) → Arial → sans-serif
// - Carlito is loaded via Next.js font optimization and available via --font-carlito CSS variable

// Helper to convert S3 key to full URL
const getResourceUrl = (key: string | undefined | null): string | undefined => {
  if (!key) return undefined;
  // If it's already a full URL, return as-is
  if (key.startsWith("http://") || key.startsWith("https://") || key.startsWith("data:")) {
    return key;
  }
  // Otherwise, prepend the S3 base URL
  const baseUrl = process.env.NEXT_PUBLIC_RESOURCE_URL || "https://aims-osiris.s3.ap-southeast-1.amazonaws.com/";
  return `${baseUrl}${key}`;
};

// Helper: renders a LABEL : VALUE row, hidden when value is empty
function InfoRow({ label, value, minWidth = "100px" }: { label: string; value: any; minWidth?: string }) {
  const displayValue = typeof value === "string" ? value.trim() : value;
  if (!displayValue && displayValue !== 0) return null;
  return (
    <Box sx={{ display: "flex" }}>
      <Typography sx={{ fontSize: "0.75rem", minWidth, lineHeight: 1.4 }}>{label}</Typography>
      <Typography sx={{ fontSize: "0.75rem", ml: 0.5, mr: 1, lineHeight: 1.4 }}>:</Typography>
      <Typography sx={{ fontSize: "0.75rem", flex: 1, lineHeight: 1.4 }}>{displayValue}</Typography>
    </Box>
  );
}

interface CleanDocumentPreviewProps {
  documentType: "QO1" | "DO" | "RDO" | "TI" | "TI2" | "MSR" | "INVOICE" | string;
  data: any;
  organization?: any;
}

export default function CleanDocumentPreview({ documentType, data, organization }: CleanDocumentPreviewProps) {
  const getDocumentTitle = () => {
    const titles: Record<string, string> = {
      // Short codes
      QO1: "QUOTATION",
      QO: "QUOTATION",
      QT: "QUOTATION",
      DO: "DELIVERY ORDER",
      RDO: "RETURN DELIVERY ORDER",
      TI: "TAX INVOICE",
      TI2: "TAX INVOICE",
      MSR: "MAINTENANCE SERVICE REPORT",
      SO: "SALES ORDER",
      DN: "DEBIT NOTE",
      CN: "CREDIT NOTE",
      PO: "PURCHASE ORDER",
      PR: "PURCHASE RETURN",
      SAI: "STOCK ADJUSTMENT IN",
      SAO: "STOCK ADJUSTMENT OUT",
      // Full names
      QUOTATION: "QUOTATION",
      INVOICE: "INVOICE",
      DELIVERY_ORDER: "DELIVERY ORDER",
      RETURN_DELIVERY_ORDER: "RETURN DELIVERY ORDER",
      MAINTENANCE_SERVICE_REPORT: "MAINTENANCE SERVICE REPORT",
      SALES_ORDER: "SALES ORDER",
      DEBIT_NOTE: "DEBIT NOTE",
      CREDIT_NOTE: "CREDIT NOTE",
      PURCHASE_ORDER: "PURCHASE ORDER",
      PURCHASE_RETURN: "PURCHASE RETURN",
      STOCK_ADJUSTMENT_IN: "STOCK ADJUSTMENT IN",
      STOCK_ADJUSTMENT_OUT: "STOCK ADJUSTMENT OUT",
    };
    return titles[documentType] || titles[documentType?.toUpperCase()] || "DOCUMENT";
  };

  // Calculate totals
  const items = data.items || [];
  const subtotal = items.reduce((acc: number, item: any) => acc + (item.amount || 0), 0);
  const totalTax = items.reduce(
    (acc: number, item: any) => acc + (item.amount || 0) * ((item.tax || 0) / 100),
    0
  );
  const total = subtotal + totalTax;

  // Format date
  const formatDate = (date: any) => {
    if (!date) return "";
    const d = new Date(date);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  };

  // Special layout for Tax Invoice
  if (documentType === "TI") {
    return (
      <Paper
        sx={{
          width: "210mm",
          minHeight: "297mm",
          margin: "0 auto",
          p: "20mm",
          backgroundColor: "white",
          fontFamily: "var(--font-carlito), 'Calibri', 'Arial', sans-serif",
          fontSize: "0.75rem",
          lineHeight: 1.6,
          color: "#000",
          "@media print": {
            margin: 0,
            padding: "20mm",
            boxShadow: "none",
          },
        }}
      >
        {/* Header with three columns */}
        <Box sx={{ display: "flex", mb: 4 }}>
          {/* Left Column - Logo, Title and Customer */}
          <Box sx={{ width: "35%" }}>
            {(data.logo || organization?.logo) && (
              <Box sx={{ mb: 2, mt: -6, maxWidth: 280, height: 120 }}>
                <img src={getResourceUrl(data.logo || organization?.logo)} alt="Company Logo" style={{ maxWidth: "100%", maxHeight: "100%" }} />
              </Box>
            )}

            <Typography
              sx={{
                fontSize: "1.25rem",
                fontWeight: 600,
                mb: 2
              }}
            >
              Tax Invoice
            </Typography>

            {/* Customer Info */}
            <Box>
              <Typography sx={{ fontSize: "0.8125rem", fontWeight: 600, mb: 0.5 }}>
                {data.customer?.name || data.customerName || ""}
              </Typography>
              <Typography sx={{ fontSize: "0.6875rem", mb: 0.3, whiteSpace: "pre-line" }}>
                {data.customer?.address || data.customerAddress || ""}
              </Typography>
              {(data.deliveryAddress?.attention || data.attention?.name) && (
                <Typography sx={{ fontSize: "0.6875rem", mb: 0.3 }}>
                  Attn: {data.deliveryAddress?.attention || data.attention?.name}
                </Typography>
              )}
            </Box>
          </Box>

          {/* Spacer */}
          <Box sx={{ width: "15%" }} />

          {/* Center Column - Invoice Details */}
          <Box sx={{ width: "20%" }}>
            <Box sx={{ mb: 1.5 }}>
              <Typography sx={{ fontSize: "0.625rem", color: "#666", mb: 0.3 }}>
                Invoice Date
              </Typography>
              <Typography sx={{ fontSize: "0.75rem", fontWeight: 500 }}>
                {formatDate(data.documentInfo?.date)}
              </Typography>
            </Box>

            <Box sx={{ mb: 1.5 }}>
              <Typography sx={{ fontSize: "0.625rem", color: "#666", mb: 0.3 }}>
                Invoice Number
              </Typography>
              <Typography sx={{ fontSize: "0.75rem", fontWeight: 500 }}>
                {data.documentInfo?.documentNumber || ""}
              </Typography>
            </Box>

            <Box sx={{ mb: 1.5 }}>
              <Typography sx={{ fontSize: "0.625rem", color: "#666", mb: 0.3 }}>
                Reference
              </Typography>
              <Typography sx={{ fontSize: "0.75rem", fontWeight: 500, whiteSpace: "pre-line" }}>
                {data.documentInfo?.referenceNo || ""}
                {data.documentInfo?.doNo && (
                  <>{'\n'}({data.documentInfo.doNo})</>
                )}
              </Typography>
            </Box>
          </Box>

          {/* Right Column - Company Details */}
          <Box sx={{ textAlign: "left", width: "30%" }}>
            <Typography sx={{ fontSize: "0.8125rem", fontWeight: 600, mb: 0.5 }}>
              {data.company?.name || organization?.name || ""}
            </Typography>
            <Typography sx={{ fontSize: "0.6875rem", mb: 0.3, whiteSpace: "pre-line" }}>
              {data.company?.address || organization?.address || ""}
            </Typography>
            <Typography sx={{ fontSize: "0.6875rem", mb: 0.3 }}>
              Tel: {data.company?.phoneNumber || organization?.phoneNumber || ""}
            </Typography>
            <Typography sx={{ fontSize: "0.6875rem", mb: 0.3 }}>
              Company & GST Reg No:
            </Typography>
            <Typography sx={{ fontSize: "0.6875rem", fontWeight: 500 }}>
              {data.company?.gstRegNo || organization?.registrationNumber || ""}
            </Typography>
          </Box>
        </Box>

        {/* Items Table */}
        <TableContainer sx={{ mb: 3, mt: 5 }}>
          <Table
            sx={{
              "& .MuiTableCell-root": {
                border: "none",
                borderBottom: "none",
                padding: "10px 8px",
                fontSize: "0.6875rem",
              },
              "& .MuiTableHead-root .MuiTableCell-root": {
                border: "none",
                borderBottom: "2px solid #000",
                fontWeight: 600,
                fontSize: "0.6875rem",
              },
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: "55%" }}>Description</TableCell>
                <TableCell sx={{ width: "15%", textAlign: "center" }}>Quantity</TableCell>
                <TableCell sx={{ width: "15%", textAlign: "right" }}>Unit Price</TableCell>
                <TableCell sx={{ width: "15%", textAlign: "right" }}>Amount SGD</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item: any, index: number) => (
                <TableRow key={index}>
                  <TableCell>
                    <Box>
                      <Typography sx={{ fontSize: "0.6875rem", fontWeight: 500, mb: 0.5 }}>
                        {item.description}
                      </Typography>
                      {item.details && (
                        <Box sx={{ pl: 1 }}>
                          {typeof item.details === 'string'
                            ? item.details.split("\n").map((detail: string, idx: number) => (
                                <Typography key={idx} sx={{ fontSize: "0.625rem", color: "#666", lineHeight: 1.4 }}>
                                  {detail}
                                </Typography>
                              ))
                            : <Typography sx={{ fontSize: "0.625rem", color: "#666", lineHeight: 1.4 }}>
                                {item.details}
                              </Typography>}
                        </Box>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell sx={{ textAlign: "center" }}>{item.quantity?.toFixed(2)}</TableCell>
                  <TableCell sx={{ textAlign: "right" }}>{item.unitPrice?.toFixed(2)}</TableCell>
                  <TableCell sx={{ textAlign: "right" }}>{(item.amount || 0).toFixed(2)}</TableCell>
                </TableRow>
              ))}

              {/* Add empty rows for spacing */}
              {items.length < 5 &&
                Array.from({ length: 5 - items.length }).map((_, index) => (
                  <TableRow key={`empty-${index}`} sx={{ height: 40 }}>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </TableContainer>

        {/* Additional Information */}
        {(data.documentInfo?.doNo || data.documentInfo?.qinRef || data.documentInfo?.woNo ||
          data.documentInfo?.location || data.documentInfo?.projectDept) && (
          <Box sx={{ mb: 3, fontSize: "0.6875rem", lineHeight: 1.8 }}>
            {data.documentInfo?.doNo && (
              <Typography sx={{ mb: 0.5 }}>
                Our DO No. {data.documentInfo.doNo} dated {formatDate(data.documentInfo.doDate)}
              </Typography>
            )}
            {data.documentInfo?.qinRef && (
              <Typography sx={{ mb: 0.5 }}>
                Our Qtn Ref. {data.documentInfo.qinRef} dated {formatDate(data.documentInfo.qinDate)}
              </Typography>
            )}
            {data.documentInfo?.woNo && (
              <Typography sx={{ mb: 0.5 }}>
                Your WO No. {data.documentInfo.woNo} dated {formatDate(data.documentInfo.woDate)}
              </Typography>
            )}
            {data.documentInfo?.location && (
              <Typography sx={{ mb: 0.5 }}>
                Location: {data.documentInfo.location}
              </Typography>
            )}
            {data.documentInfo?.projectDept && (
              <Typography sx={{ mb: 0.5 }}>
                Project/Dept : {data.documentInfo.projectDept}
              </Typography>
            )}
          </Box>
        )}

        {/* Totals */}
        <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 4 }}>
          <Box sx={{ width: 350 }}>
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                py: 1,
                borderTop: "1px solid #000",
              }}
            >
              <Typography sx={{ fontSize: "0.75rem", textAlign: "right", width: "60%" }}>
                Subtotal
              </Typography>
              <Typography sx={{ fontSize: "0.75rem", textAlign: "right", width: "40%" }}>
                {subtotal.toFixed(2)}
              </Typography>
            </Box>

            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                py: 1,
                borderBottom: "1px solid #000",
              }}
            >
              <Typography sx={{ fontSize: "0.6875rem", textAlign: "right", width: "60%" }}>
                TOTAL LOCAL SUPPLY OF GOODS<br />AND SERVICES 9%
              </Typography>
              <Typography sx={{ fontSize: "0.75rem", textAlign: "right", width: "40%", alignSelf: "flex-end" }}>
                {totalTax.toFixed(2)}
              </Typography>
            </Box>

            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                py: 1,
                borderBottom: "2px solid #000",
              }}
            >
              <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, textAlign: "right", width: "60%" }}>
                TOTAL SGD
              </Typography>
              <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, textAlign: "right", width: "40%" }}>
                {total.toFixed(2)}
              </Typography>
            </Box>
          </Box>
        </Box>

        {/* Due Date and Payment Info */}
        <Box sx={{ mt: 6, lineHeight: 1.8 }}>
          <Typography sx={{ fontSize: "11px", fontWeight: 600, mb: 1 }}>
            Due Date: {formatDate(data.dueDate) || "30 Nov 2024"}
          </Typography>
          <Typography sx={{ fontSize: "11px", mb: 0.3 }}>
            All Cheque should be crossed and made payable to: {data.company?.name || organization?.name || ""}
          </Typography>
          <Typography sx={{ fontSize: "11px", mb: 0.3 }}>
            By Bank Transfer: {data.bankDetails?.bankName || "Standard Chartered Bank"}
          </Typography>
          <Typography sx={{ fontSize: "11px", mb: 0.3 }}>
            Branch: {data.bankDetails?.branch || "12 Marina Boulevard, Marina Bay Financial Centre Tower 1"}
          </Typography>
          <Typography sx={{ fontSize: "11px", mb: 0.3 }}>
            Bank Branch No.: {data.bankDetails?.branchNo || "9496-007"} Swift Code: {data.bankDetails?.swiftCode || "SCBLSG22"}
          </Typography>
          <Typography sx={{ fontSize: "11px", mb: 0.3 }}>
            Bank Account No.: {data.bankDetails?.accountNo || "07-1-005302-9"}
          </Typography>
          <Typography sx={{ fontSize: "11px", mb: 0.3 }}>
            PayNow to UEN: {data.company?.gstRegNo || "200303416N"}
          </Typography>
        </Box>

        {/* Footer */}
        <Box sx={{ mt: 4, pt: 2, textAlign: "center" }}>
          <Typography sx={{ fontSize: "0.625rem", fontStyle: "italic", color: "#666" }}>
            This is a computer-generated document, no signature is required
          </Typography>
        </Box>
      </Paper>
    );
  }

  // Sales Order Layout
  if (documentType === "SO" || documentType === "SALES_ORDER") {
    return (
      <Paper
        sx={{
          width: "210mm",
          minHeight: "297mm",
          margin: "0 auto",
          p: "20mm",
          backgroundColor: "white",
          fontFamily: "var(--font-carlito), 'Calibri', 'Arial', sans-serif",
          fontSize: "0.75rem",
          lineHeight: 1.6,
          color: "#000",
          display: "flex",
          flexDirection: "column",
          "@media print": {
            margin: 0,
            padding: "20mm",
            boxShadow: "none",
          },
        }}
      >
        {/* Company Header - Centered */}
        <Box sx={{ textAlign: "center", mb: 2, mt: -6 }}>
          <Typography sx={{ fontSize: "1.125rem", fontWeight: 700, mb: 0.3, letterSpacing: "0.5px" }}>
            {data.company?.name || organization?.name || ""}
          </Typography>
          <Typography sx={{ fontSize: "0.75rem", mb: 0.2 }}>
            GST Reg No: {data.company?.gstRegNo || organization?.registrationNumber || ""}
            {data.company?.coRegNo && ` Co. Reg No: ${data.company.coRegNo}`}
          </Typography>
          <Typography sx={{ fontSize: "0.75rem", mb: 0.2 }}>
            {data.company?.address || organization?.address || ""}
          </Typography>
          {data.company?.address2 && (
            <Typography sx={{ fontSize: "0.75rem", mb: 0.2 }}>
              {data.company.address2}
            </Typography>
          )}
          <Typography sx={{ fontSize: "0.75rem" }}>
            Tel: {data.company?.phoneNumber || organization?.phoneNumber || ""}
            {data.company?.fax && ` Fax: ${data.company.fax}`}
          </Typography>
        </Box>

        {/* Customer and Sales Order Details Section */}
        <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1, alignItems: "flex-start" }}>
          {/* Left - Bill To and Deliver To Section */}
          <Box sx={{ width: "45%" }}>
            {/* Bill To */}
            <Box sx={{ mb: 3 }}>
              <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, mb: 0.5 }}>Bill To :</Typography>
              <Typography sx={{ fontSize: "0.75rem", fontWeight: 600 }}>
                {data.customer?.name || data.customerName || ""}
              </Typography>
              <Typography sx={{ fontSize: "0.75rem", whiteSpace: "pre-line" }}>
                {data.billTo || data.customer?.address || data.customerAddress || ""}
              </Typography>
            </Box>

            {/* Deliver To - hidden when deliver to address is empty */}
            {data.deliveryTo && (
            <Box>
              <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, mb: 0.5 }}>Deliver To :</Typography>
              <Typography sx={{ fontSize: "0.75rem", whiteSpace: "pre-line" }}>
                {data.deliveryTo}
              </Typography>
              {(data.documentInfo?.contactName || data.documentInfo?.contact || data.contact) && (
                <Typography sx={{ fontSize: "0.75rem" }}>
                  Attn: {data.documentInfo?.contactName || data.documentInfo?.contact || data.contact}
                  {data.documentInfo?.contactNumber ? ` (${data.documentInfo.contactNumber})` : ""}
                </Typography>
              )}
            </Box>
            )}
          </Box>

          {/* Right - Sales Order Details */}
          <Box sx={{ width: "45%", display: "flex", justifyContent: "flex-end", pl: 4 }}>
            <Box sx={{ lineHeight: 1.4 }}>
            {/* Sales Order Title */}
            <Typography sx={{ fontSize: "1rem", fontWeight: 700, mb: 1 }}>
              SALES ORDER
            </Typography>
            <InfoRow label="S/O NUMBER" value={data.documentInfo?.documentNumber} />
            <InfoRow label="DATE" value={formatDate(data.documentInfo?.date)} />
            <InfoRow label="CUSTOMER CODE" value={data.customer?.customerCode} />
            <InfoRow label="SALESMAN" value={data.documentInfo?.salesPerson || data.documentInfo?.salesman} />
            <InfoRow label="P/O NUMBER" value={data.documentInfo?.poNo} />
            <InfoRow label="DELIVERY DATE" value={formatDate(data.documentInfo?.deliveryDate)} />
            <InfoRow label="CONTACT NAME" value={data.documentInfo?.contactName || data.documentInfo?.contact || data.contact} />
            <InfoRow label="CONTACT NO." value={data.documentInfo?.contactNumber} />
            <InfoRow label="TERMS" value={data.documentInfo?.paymentTerms} />
            <InfoRow label="CURRENCY" value={data.documentInfo?.currency} />
            </Box>
          </Box>
        </Box>

        {/* Items Table */}
        <TableContainer sx={{ mb: 3, mt: 0.5 }}>
          <Table
            sx={{
              "& .MuiTableCell-root": {
                border: "none",
                borderBottom: "none",
                padding: "10px 8px",
                fontSize: "0.6875rem",
              },
              "& .MuiTableHead-root .MuiTableCell-root": {
                border: "none",
                borderBottom: "2px solid #000",
                fontWeight: 600,
                fontSize: "0.6875rem",
              },
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: "55%" }}>Description</TableCell>
                <TableCell sx={{ width: "15%", textAlign: "center" }}>Quantity</TableCell>
                <TableCell sx={{ width: "15%", textAlign: "right" }}>Unit Price</TableCell>
                <TableCell sx={{ width: "15%", textAlign: "right" }}>Amount {data.documentInfo?.currency || "SGD"}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item: any, index: number) => (
                <TableRow key={index}>
                  <TableCell>
                    <Box>
                      <Typography sx={{ fontSize: "0.6875rem", fontWeight: 500, mb: 0.5 }}>
                        {item.description}
                      </Typography>
                      {item.details && (
                        <Box sx={{ pl: 1 }}>
                          {typeof item.details === 'string'
                            ? item.details.split("\n").map((detail: string, idx: number) => (
                                <Typography key={idx} sx={{ fontSize: "0.625rem", color: "#666", lineHeight: 1.4 }}>
                                  {detail}
                                </Typography>
                              ))
                            : <Typography sx={{ fontSize: "0.625rem", color: "#666", lineHeight: 1.4 }}>
                                {item.details}
                              </Typography>}
                        </Box>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell sx={{ textAlign: "center" }}>{item.quantity?.toFixed(2)}</TableCell>
                  <TableCell sx={{ textAlign: "right" }}>{item.unitPrice?.toFixed(2)}</TableCell>
                  <TableCell sx={{ textAlign: "right" }}>{(item.amount || 0).toFixed(2)}</TableCell>
                </TableRow>
              ))}

              {/* Add empty rows for spacing */}
              {items.length < 5 &&
                Array.from({ length: 5 - items.length }).map((_, index) => (
                  <TableRow key={`empty-${index}`} sx={{ height: 40 }}>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </TableContainer>

        {/* Totals Section */}
        <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 3 }}>
          <Box sx={{ width: "250px" }}>
            <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
              <Typography sx={{ fontSize: "0.75rem" }}>Sub Total:</Typography>
              <Typography sx={{ fontSize: "0.75rem" }}>{subtotal.toFixed(2)}</Typography>
            </Box>
            {(data.documentInfo?.discountPercent || data.documentInfo?.discount) > 0 && (
              <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                <Typography sx={{ fontSize: "0.75rem" }}>Discount:</Typography>
                <Typography sx={{ fontSize: "0.75rem" }}>-{(data.documentInfo?.discount || 0).toFixed(2)}</Typography>
              </Box>
            )}
            {totalTax > 0 && (
              <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                <Typography sx={{ fontSize: "0.75rem" }}>GST ({data.documentInfo?.gstPercent || 9}%):</Typography>
                <Typography sx={{ fontSize: "0.75rem" }}>{totalTax.toFixed(2)}</Typography>
              </Box>
            )}
            <Box sx={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #000", pt: 0.5 }}>
              <Typography sx={{ fontSize: "0.75rem", fontWeight: 600 }}>Total {data.documentInfo?.currency || "SGD"}:</Typography>
              <Typography sx={{ fontSize: "0.75rem", fontWeight: 600 }}>{(total - (data.documentInfo?.discount || 0)).toFixed(2)}</Typography>
            </Box>
          </Box>
        </Box>

        {/* Footer */}
        <Box sx={{ mt: "auto", pt: 4 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
            <Box sx={{ width: "45%" }}>
              <Typography sx={{ fontSize: "0.6875rem", mb: 0.5 }}>Remarks:</Typography>
              <Typography sx={{ fontSize: "0.6875rem", whiteSpace: "pre-line" }}>{data.remarks || ""}</Typography>
            </Box>
            <Box sx={{ width: "45%", textAlign: "center" }}>
              <Box sx={{ borderBottom: "1px solid #000", mb: 0.5, height: 60 }}></Box>
              <Typography sx={{ fontSize: "0.6875rem" }}>Authorized Signature</Typography>
            </Box>
          </Box>
        </Box>
      </Paper>
    );
  }

  // TI2 - Elshis-style Tax Invoice Layout
  if (documentType === "TI2" || documentType === "INVOICE") {
    return (
      <Paper
        sx={{
          width: "210mm",
          minHeight: "297mm",
          margin: "0 auto",
          p: "20mm",
          backgroundColor: "white",
          fontFamily: "var(--font-carlito), 'Calibri', 'Arial', sans-serif",
          fontSize: "0.75rem",
          lineHeight: 1.6,
          color: "#000",
          display: "flex",
          flexDirection: "column",
          "@media print": {
            margin: 0,
            padding: "20mm",
            boxShadow: "none",
          },
        }}
      >
        {/* Company Header - Centered */}
        <Box sx={{ textAlign: "center", mb: 2, mt: -6 }}>
          <Typography sx={{ fontSize: "1.125rem", fontWeight: 700, mb: 0.3, letterSpacing: "0.5px" }}>
            {data.company?.name || organization?.name || "ELSHIS INTERNATIONAL PTE LTD"}
          </Typography>
          <Typography sx={{ fontSize: "0.75rem", mb: 0.2 }}>
            GST Reg No: {data.company?.gstRegNo || organization?.registrationNumber || "200303416N"}
            {data.company?.coRegNo && ` Co. Reg No: ${data.company.coRegNo}`}
          </Typography>
          <Typography sx={{ fontSize: "0.75rem", mb: 0.2 }}>
            {data.company?.address || organization?.address || "No. 2 Kelling Ave, 01-07 Kelling Beltra Complex,"}
          </Typography>
          {data.company?.address2 && (
            <Typography sx={{ fontSize: "0.75rem", mb: 0.2 }}>
              {data.company.address2}
            </Typography>
          )}
          <Typography sx={{ fontSize: "0.75rem" }}>
            Tel: {data.company?.phoneNumber || organization?.phoneNumber || ""}
            {data.company?.fax && ` Fax: ${data.company.fax}`}
          </Typography>
        </Box>

        {/* Customer and Invoice Details Section */}
        <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1, alignItems: "flex-start" }}>
          {/* Left - Bill To and Deliver To Section */}
          <Box sx={{ width: "45%" }}>
            {/* Bill To */}
            <Box sx={{ mb: 3 }}>
              <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, mb: 0.5 }}>Bill To :</Typography>
              <Typography sx={{ fontSize: "0.75rem", fontWeight: 600 }}>
                {data.customer?.name || data.customerName || ""}
              </Typography>
              <Typography sx={{ fontSize: "0.75rem", whiteSpace: "pre-line" }}>
                {data.billTo || data.customer?.address || data.customerAddress || ""}
              </Typography>
            </Box>

            {/* Deliver To - hidden when deliver to address is empty */}
            {data.deliveryTo && (
            <Box>
              <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, mb: 0.5 }}>Deliver To :</Typography>
              <Typography sx={{ fontSize: "0.75rem", whiteSpace: "pre-line" }}>
                {data.deliveryTo}
              </Typography>
              {(data.documentInfo?.contactName || data.documentInfo?.contact || data.contact) && (
                <Typography sx={{ fontSize: "0.75rem" }}>
                  Attn: {data.documentInfo?.contactName || data.documentInfo?.contact || data.contact}
                  {data.documentInfo?.contactNumber ? ` (${data.documentInfo.contactNumber})` : ""}
                </Typography>
              )}
            </Box>
            )}
          </Box>

          {/* Right - Invoice Details with Tax Invoice Title */}
          <Box sx={{ width: "45%", display: "flex", justifyContent: "flex-end", pl: 4 }}>
            <Box sx={{ lineHeight: 1.4 }}>
            {/* Tax Invoice Title */}
            <Typography sx={{ fontSize: "1rem", fontWeight: 700, mb: 1 }}>
              TAX INVOICE
            </Typography>
            <InfoRow label="GST Reg No." value={data.company?.gstRegNo || organization?.registrationNumber} minWidth="85px" />
            <InfoRow label="INVOICE NO." value={data.documentInfo?.documentNumber} minWidth="85px" />
            <InfoRow label="DATE" value={formatDate(data.documentInfo?.date)} minWidth="85px" />
            <InfoRow label="DO NO" value={data.documentInfo?.doNo} minWidth="85px" />
            <InfoRow label="P/O NO" value={data.documentInfo?.poNo} minWidth="85px" />
            <InfoRow label="SALESMAN" value={data.documentInfo?.salesPerson || data.documentInfo?.salesman} minWidth="85px" />
            <InfoRow label="PAGE" value={data.documentInfo?.page || "1"} minWidth="85px" />
            <InfoRow label="TERMS" value={data.documentInfo?.paymentTerms || "0 DAYS"} minWidth="85px" />
            <InfoRow label="CURRENCY" value={data.documentInfo?.currency || "USD"} minWidth="85px" />
            </Box>
          </Box>
        </Box>

        {/* Items Table - Same as TI template */}
        <TableContainer sx={{ mb: 3, mt: 0.5 }}>
          <Table
            sx={{
              "& .MuiTableCell-root": {
                border: "none",
                borderBottom: "none",
                padding: "10px 8px",
                fontSize: "0.6875rem",
              },
              "& .MuiTableHead-root .MuiTableCell-root": {
                border: "none",
                borderBottom: "2px solid #000",
                fontWeight: 600,
                fontSize: "0.6875rem",
              },
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: "55%" }}>Description</TableCell>
                <TableCell sx={{ width: "15%", textAlign: "center" }}>Quantity</TableCell>
                <TableCell sx={{ width: "15%", textAlign: "right" }}>Unit Price</TableCell>
                <TableCell sx={{ width: "15%", textAlign: "right" }}>Amount SGD</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item: any, index: number) => (
                <TableRow key={index}>
                  <TableCell>
                    <Box>
                      <Typography sx={{ fontSize: "0.6875rem", fontWeight: 500, mb: 0.5 }}>
                        {item.description}
                      </Typography>
                      {item.details && (
                        <Box sx={{ pl: 1 }}>
                          {typeof item.details === 'string'
                            ? item.details.split("\n").map((detail: string, idx: number) => (
                                <Typography key={idx} sx={{ fontSize: "0.625rem", color: "#666", lineHeight: 1.4 }}>
                                  {detail}
                                </Typography>
                              ))
                            : <Typography sx={{ fontSize: "0.625rem", color: "#666", lineHeight: 1.4 }}>
                                {item.details}
                              </Typography>}
                        </Box>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell sx={{ textAlign: "center" }}>{item.quantity?.toFixed(2)}</TableCell>
                  <TableCell sx={{ textAlign: "right" }}>{item.unitPrice?.toFixed(2)}</TableCell>
                  <TableCell sx={{ textAlign: "right" }}>{(item.amount || 0).toFixed(2)}</TableCell>
                </TableRow>
              ))}

              {/* Add empty rows for spacing */}
              {items.length < 5 &&
                Array.from({ length: 5 - items.length }).map((_, index) => (
                  <TableRow key={`empty-${index}`} sx={{ height: 40 }}>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </TableContainer>

        {/* Additional Information */}
        {(data.documentInfo?.qinRef || data.documentInfo?.woNo ||
          data.documentInfo?.location || data.documentInfo?.projectDept) && (
          <Box sx={{ mb: 3, fontSize: "0.6875rem", lineHeight: 1.8 }}>
            {data.documentInfo?.qinRef && (
              <Typography sx={{ mb: 0.5 }}>
                Our Qtn Ref. {data.documentInfo.qinRef} dated {formatDate(data.documentInfo.qinDate)}
              </Typography>
            )}
            {data.documentInfo?.woNo && (
              <Typography sx={{ mb: 0.5 }}>
                Your WO No. {data.documentInfo.woNo} dated {formatDate(data.documentInfo.woDate)}
              </Typography>
            )}
            {data.documentInfo?.location && (
              <Typography sx={{ mb: 0.5 }}>
                Location: {data.documentInfo.location}
              </Typography>
            )}
            {data.documentInfo?.projectDept && (
              <Typography sx={{ mb: 0.5 }}>
                Project/Dept : {data.documentInfo.projectDept}
              </Typography>
            )}
          </Box>
        )}

        {/* Bottom Section Container - Pushed to bottom of page */}
        <Box sx={{ mt: "auto" }}>
        {/* Bottom Summary Row and Totals - TI2 Style */}
        {(() => {
          const rate = data.documentInfo?.rate || 1;
          const currency = data.documentInfo?.currency || "SGD";
          const discountPercent = data.documentInfo?.discountPercent || data.documentInfo?.discount || 0;
          const isTaxApplicable = data.documentInfo?.taxApplicable !== 'N' && data.documentInfo?.taxApplicable !== false;
          const gstPercent = isTaxApplicable ? (data.documentInfo?.gstPercent || 9) : 0;
          console.log("=== CleanDocumentPreview GST DEBUG ===");
          console.log("data.documentInfo:", JSON.stringify(data.documentInfo));
          console.log("data.documentInfo?.gstPercent:", data.documentInfo?.gstPercent);
          console.log("resolved gstPercent:", gstPercent);

          // Calculate values
          const isAbsorbTax = data.documentInfo?.absorbTax === 'Y' || data.documentInfo?.absorbTax === true;
          const grossTotal = subtotal;
          const discountAmount = grossTotal * (discountPercent / 100);
          const subtotalAfterDiscount = grossTotal - discountAmount;
          const gstAmount = isAbsorbTax && gstPercent > 0
            ? subtotalAfterDiscount * gstPercent / (100 + gstPercent)
            : subtotalAfterDiscount * (gstPercent / 100);
          const finalTotal = isAbsorbTax ? subtotalAfterDiscount : subtotalAfterDiscount + gstAmount;

          return (
            <Box sx={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #000", pt: 1 }}>
              {/* Left Side - Rate, Sub-total, GST summary */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 3 }}>
                <Box sx={{ display: "flex", alignItems: "center" }}>
                  <Typography sx={{ fontSize: "0.6875rem" }}>(Rate :</Typography>
                  <Typography sx={{ fontSize: "0.6875rem", ml: 1, minWidth: 60 }}>{rate.toFixed(6)}</Typography>
                </Box>
                <Box sx={{ display: "flex", alignItems: "center" }}>
                  <Typography sx={{ fontSize: "0.6875rem" }}>Sub-total:</Typography>
                  <Typography sx={{ fontSize: "0.6875rem", ml: 1, minWidth: 50, textAlign: "right" }}>{subtotalAfterDiscount.toFixed(2)}</Typography>
                </Box>
                <Box sx={{ display: "flex", alignItems: "center" }}>
                  <Typography sx={{ fontSize: "0.6875rem" }}>GST</Typography>
                  <Typography sx={{ fontSize: "0.6875rem", ml: 1 }}>:</Typography>
                  <Typography sx={{ fontSize: "0.6875rem", ml: 1, minWidth: 40, textAlign: "right" }}>{gstAmount.toFixed(2)})</Typography>
                </Box>
              </Box>

              {/* Right Side - Detailed Totals */}
              <Box sx={{ minWidth: 200 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.3 }}>
                  <Typography sx={{ fontSize: "0.6875rem" }}>Sub-Total</Typography>
                  <Typography sx={{ fontSize: "0.6875rem", textAlign: "right" }}>{grossTotal.toFixed(2)}</Typography>
                </Box>
                {discountPercent > 0 && (
                  <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.3 }}>
                    <Typography sx={{ fontSize: "0.6875rem" }}>Discount</Typography>
                    <Box sx={{ display: "flex", gap: 2 }}>
                      <Typography sx={{ fontSize: "0.6875rem" }}>{discountPercent.toFixed(2)}</Typography>
                      <Typography sx={{ fontSize: "0.6875rem", textAlign: "right", minWidth: 50 }}>{discountAmount.toFixed(2)}</Typography>
                    </Box>
                  </Box>
                )}
                {discountPercent > 0 && (
                  <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.3 }}>
                    <Typography sx={{ fontSize: "0.6875rem" }}>Sub-Total</Typography>
                    <Typography sx={{ fontSize: "0.6875rem", textAlign: "right" }}>{subtotalAfterDiscount.toFixed(2)}</Typography>
                  </Box>
                )}
                <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.3 }}>
                  <Typography sx={{ fontSize: "0.6875rem" }}>GST</Typography>
                  <Box sx={{ display: "flex", gap: 2 }}>
                    <Typography sx={{ fontSize: "0.6875rem" }}>{gstPercent.toFixed(2)} %</Typography>
                    <Typography sx={{ fontSize: "0.6875rem", textAlign: "right", minWidth: 50 }}>{gstAmount.toFixed(2)}</Typography>
                  </Box>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.3, borderTop: "1px solid #000", mt: 0.5, pt: 0.5 }}>
                  <Typography sx={{ fontSize: "0.6875rem" }}>Total</Typography>
                  <Box sx={{ display: "flex", gap: 2 }}>
                    <Typography sx={{ fontSize: "0.6875rem" }}>{currency}</Typography>
                    <Typography sx={{ fontSize: "0.6875rem", fontWeight: 600, textAlign: "right", minWidth: 50 }}>{finalTotal.toFixed(2)}</Typography>
                  </Box>
                </Box>
              </Box>
            </Box>
          );
        })()}

        {/* Amount in Words */}
        {(() => {
          const rate = data.documentInfo?.rate || 1;
          const discountPercent = data.documentInfo?.discountPercent || data.documentInfo?.discount || 0;
          const isTaxApplicable = data.documentInfo?.taxApplicable !== 'N' && data.documentInfo?.taxApplicable !== false;
          const gstPercent = isTaxApplicable ? (data.documentInfo?.gstPercent || 9) : 0;
          const grossTotal = subtotal;
          const discountAmount = grossTotal * (discountPercent / 100);
          const subtotalAfterDiscount = grossTotal - discountAmount;
          const gstAmount = subtotalAfterDiscount * (gstPercent / 100);
          const finalTotal = subtotalAfterDiscount + gstAmount;

          // Convert number to words
          const numberToWords = (num: number): string => {
            const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
              'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
            const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];

            if (num === 0) return 'ZERO';

            const convertHundreds = (n: number): string => {
              let str = '';
              if (n >= 100) {
                str += ones[Math.floor(n / 100)] + ' HUNDRED ';
                n %= 100;
              }
              if (n >= 20) {
                str += tens[Math.floor(n / 10)] + ' ';
                n %= 10;
              }
              if (n > 0) {
                str += ones[n] + ' ';
              }
              return str;
            };

            let result = '';
            const dollars = Math.floor(num);
            const cents = Math.round((num - dollars) * 100);

            if (dollars >= 1000) {
              result += convertHundreds(Math.floor(dollars / 1000)) + 'THOUSAND ';
            }
            result += convertHundreds(dollars % 1000);

            if (cents > 0) {
              result += 'AND CENTS ' + convertHundreds(cents);
            }

            return result.trim() + ' ONLY.';
          };

          return (
            <Box sx={{ mt: 2, borderBottom: "2px solid #000", pb: 1 }}>
              <Typography sx={{ fontSize: "0.6875rem", fontWeight: 500 }}>
                S'PORE DOLLAR {numberToWords(finalTotal)}
              </Typography>
            </Box>
          );
        })()}

        {/* Footer - Due Date, Bank Details, Notes & Computer Generated Notice */}
        <Box sx={{ mt: 2, borderTop: "2px solid #000", pt: 1.5 }}>
          {/* Due Date - calculated from invoice date + payment terms */}
          {(() => {
            const invoiceDate = data.documentInfo?.date;
            const terms = data.documentInfo?.paymentTerms;
            const termDays = parseInt(String(terms).replace(/\D/g, '')) || 0;
            if (invoiceDate && termDays > 0) {
              const due = new Date(invoiceDate);
              due.setDate(due.getDate() + termDays);
              const formatted = due.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
              return (
                <Typography sx={{ fontSize: "0.6875rem", fontWeight: 700, mb: 0.5 }}>
                  Due Date: {formatted}
                </Typography>
              );
            }
            return null;
          })()}
        <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2 }}>
          {/* Left - Bank Details from Organization */}
          <Box sx={{ flex: 1, maxWidth: "55%" }}>
            {(() => {
              const bank = organization?.bankDetails;
              const hasBank = bank && (bank.accountName || bank.accountNumber || bank.bankName);
              return (
                <>
                  {hasBank && (
                    <Box sx={{ fontSize: "0.5625rem", lineHeight: 1.6 }}>
                      {bank.accountName && <Typography sx={{ fontSize: "0.5625rem" }}>All Cheque should be crossed and made payable to: {bank.accountName}</Typography>}
                      {bank.bankName && <Typography sx={{ fontSize: "0.5625rem" }}>By Bank Transfer: {bank.bankName}</Typography>}
                      {bank.branchCode && <Typography sx={{ fontSize: "0.5625rem" }}>Branch: {bank.branchCode}</Typography>}
                      {(bank.bankCode || bank.swiftCode) && <Typography sx={{ fontSize: "0.5625rem" }}>Bank Branch No.: {bank.bankCode || ""}{bank.swiftCode ? ` Swift Code: ${bank.swiftCode}` : ""}</Typography>}
                      {bank.accountNumber && <Typography sx={{ fontSize: "0.5625rem" }}>Bank Account No.: {bank.accountNumber}</Typography>}
                      {organization?.registrationNumber && <Typography sx={{ fontSize: "0.5625rem" }}>PayNow to UEN: {organization.registrationNumber}</Typography>}
                    </Box>
                  )}
                  {!hasBank && <Typography sx={{ fontSize: "0.5625rem" }}>&nbsp;</Typography>}
                </>
              );
            })()}
          </Box>

          {/* Center - PayNow QR */}
          {data.payNowQR && (
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <img src={getResourceUrl(data.payNowQR)} alt="PayNow QR" style={{ width: 60, height: 60 }} />
            </Box>
          )}

          {/* Right - Computer generated notice */}
          <Box sx={{ textAlign: "right" }}>
            <Typography sx={{ fontSize: "0.6875rem", fontStyle: "italic" }}>
              This is a computer generated Invoice.
            </Typography>
            <Typography sx={{ fontSize: "0.6875rem", fontStyle: "italic" }}>
              No signature is required.
            </Typography>
          </Box>
        </Box>

        {/* Notes & T&C side by side */}
        {(data.note || data.termsAndConditions) && (
          <Box sx={{ display: "flex", gap: 3, mt: 1 }}>
            {data.note && (
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: "0.5625rem", fontWeight: 600 }}>Note:</Typography>
                <Typography sx={{ fontSize: "0.5625rem", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{data.note}</Typography>
              </Box>
            )}
            {data.termsAndConditions && (
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: "0.5625rem", fontWeight: 600 }}>Terms & Conditions:</Typography>
                <Typography sx={{ fontSize: "0.5625rem", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{data.termsAndConditions}</Typography>
              </Box>
            )}
          </Box>
        )}
        </Box>
        </Box>

      </Paper>
    );
  }

  // DO - Delivery Order Layout (same style as TI2)
  if (documentType === "DO") {
    return (
      <Paper
        sx={{
          width: "210mm",
          minHeight: "297mm",
          margin: "0 auto",
          p: "20mm",
          backgroundColor: "white",
          fontFamily: "var(--font-carlito), 'Calibri', 'Arial', sans-serif",
          fontSize: "0.75rem",
          lineHeight: 1.6,
          color: "#000",
          display: "flex",
          flexDirection: "column",
          "@media print": {
            margin: 0,
            padding: "20mm",
            boxShadow: "none",
          },
        }}
      >
        {/* Company Header - Centered */}
        <Box sx={{ textAlign: "center", mb: 2, mt: -6 }}>
          <Typography sx={{ fontSize: "1.125rem", fontWeight: 700, mb: 0.3, letterSpacing: "0.5px" }}>
            {data.company?.name || organization?.name || ""}
          </Typography>
          <Typography sx={{ fontSize: "0.75rem", mb: 0.2 }}>
            Tel: {data.company?.phoneNumber || organization?.phoneNumber || ""}
            {data.company?.fax && `  Fax: ${data.company.fax}`}
          </Typography>
          <Typography sx={{ fontSize: "0.75rem" }}>
            NPWP No: {data.company?.gstRegNo || organization?.registrationNumber || ""}
          </Typography>
        </Box>

        {/* DO Reference Number - Top Right */}
        <Box sx={{ textAlign: "right", mb: 1 }}>
          <Typography sx={{ fontSize: "0.75rem" }}>
            DO {data.documentInfo?.referenceNo || data.documentInfo?.documentNumber || ""}
          </Typography>
        </Box>

        {/* Customer and DO Details Section */}
        <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1, alignItems: "flex-start" }}>
          {/* Left - Bill To and Deliver To Section */}
          <Box sx={{ width: "45%" }}>
            {/* Bill To */}
            <Box sx={{ mb: 3 }}>
              <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, mb: 0.5 }}>Bill To :</Typography>
              <Typography sx={{ fontSize: "0.75rem", fontWeight: 600 }}>
                {data.customer?.name || data.customerName || ""}
              </Typography>
              <Typography sx={{ fontSize: "0.75rem", whiteSpace: "pre-line" }}>
                {data.billTo || data.customer?.address || data.customerAddress || ""}
              </Typography>
            </Box>

            {/* Deliver To - hidden when deliver to address is empty */}
            {data.deliveryTo && (
            <Box>
              <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, mb: 0.5 }}>Deliver To :</Typography>
              <Typography sx={{ fontSize: "0.75rem", whiteSpace: "pre-line" }}>
                {data.deliveryTo}
              </Typography>
              {(data.documentInfo?.contactName || data.documentInfo?.contact || data.contact) && (
                <Typography sx={{ fontSize: "0.75rem" }}>
                  Attn: {data.documentInfo?.contactName || data.documentInfo?.contact || data.contact}
                  {data.documentInfo?.contactNumber ? ` (${data.documentInfo.contactNumber})` : ""}
                </Typography>
              )}
            </Box>
            )}
          </Box>

          {/* Right - DO Details */}
          <Box sx={{ width: "45%", display: "flex", justifyContent: "flex-end", pl: 4 }}>
            <Box sx={{ lineHeight: 1.4 }}>
              {/* Delivery Order Title */}
              <Typography sx={{ fontSize: "1rem", fontWeight: 700, mb: 0.5 }}>
                DELIVERY ORDER
              </Typography>
              <InfoRow label="NPWP No." value={data.customer?.gstRegNo || data.customer?.npwp || data.company?.gstRegNo || data.gstRegNo} />
              <Box sx={{ display: "flex" }}>
                <Typography sx={{ fontSize: "0.75rem", minWidth: "100px", lineHeight: 1.4 }}>DELIVERY ORDER</Typography>
                <Typography sx={{ fontSize: "0.75rem", ml: 0.5, mr: 1, lineHeight: 1.4 }}></Typography>
                <Typography sx={{ fontSize: "0.75rem", flex: 1, lineHeight: 1.4, fontWeight: 600 }}>{data.documentInfo?.documentNumber || data.name || ""}</Typography>
              </Box>
              <InfoRow label="Date" value={formatDate(data.documentInfo?.date || data.date)} />
              <InfoRow label="P/O No." value={data.documentInfo?.poNo || data.poNo} />
              <InfoRow label="Terms" value={data.documentInfo?.paymentTerms || data.paymentTerms || "CASH"} />
              <InfoRow label="Salesman" value={data.documentInfo?.salesPerson || data.salesPerson} />
              <InfoRow label="Customer" value={data.customerCode || data.customer?.customerCode} />
            </Box>
          </Box>
        </Box>

        {/* Items Table */}
        <TableContainer sx={{ mb: 3, mt: 0.5 }}>
          <Table
            sx={{
              "& .MuiTableCell-root": {
                border: "none",
                borderBottom: "none",
                padding: "10px 8px",
                fontSize: "0.6875rem",
              },
              "& .MuiTableHead-root .MuiTableCell-root": {
                border: "none",
                borderBottom: "2px solid #000",
                fontWeight: 600,
                fontSize: "0.6875rem",
              },
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: "10%" }}>Item</TableCell>
                <TableCell sx={{ width: "45%" }}>Description</TableCell>
                <TableCell sx={{ width: "15%", textAlign: "center" }}>Quantity</TableCell>
                <TableCell sx={{ width: "10%", textAlign: "center" }}>uom</TableCell>
                <TableCell sx={{ width: "20%" }}>Remarks</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item: any, index: number) => (
                <TableRow key={index}>
                  <TableCell>{item.itemCode || ""}</TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: "0.6875rem", fontWeight: 500 }}>
                      {item.description}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ textAlign: "center" }}>{item.quantity?.toFixed(2)}</TableCell>
                  <TableCell sx={{ textAlign: "center" }}>{item.uom || ""}</TableCell>
                  <TableCell>{item.remarks || ""}</TableCell>
                </TableRow>
              ))}

              {/* Add empty rows for spacing */}
              {items.length < 5 &&
                Array.from({ length: 5 - items.length }).map((_, index) => (
                  <TableRow key={`empty-${index}`} sx={{ height: 40 }}>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </TableContainer>

        {/* Bottom Signature Section - DO Style - Pushed to bottom of page */}
        <Box sx={{ mt: "auto", borderTop: "1px solid #000", pt: 2 }}>
          {/* Header Row - "Goods Received" on left, Company name on right */}
          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 6 }}>
            <Typography sx={{ fontSize: "0.6875rem" }}>
              Goods Received In Good Order & Condition
            </Typography>
            <Typography sx={{ fontSize: "0.6875rem", fontWeight: 600 }}>
              {organization?.name || ""}
            </Typography>
          </Box>

          {/* Signature Lines Row */}
          <Box sx={{ display: "flex", justifyContent: "space-between", mt: 4 }}>
            {/* Chop & Sign */}
            <Box sx={{ textAlign: "center", flex: 1 }}>
              <Box sx={{ borderTop: "1px solid #000", width: "80%", mx: "auto", pt: 0.5 }}>
                <Typography sx={{ fontSize: "0.6875rem" }}>
                  Chop & Sign
                </Typography>
              </Box>
            </Box>

            {/* Delivery By */}
            <Box sx={{ textAlign: "center", flex: 1 }}>
              <Box sx={{ borderTop: "1px solid #000", width: "80%", mx: "auto", pt: 0.5 }}>
                <Typography sx={{ fontSize: "0.6875rem" }}>
                  Delivery By
                </Typography>
              </Box>
            </Box>

            {/* Issue By */}
            <Box sx={{ textAlign: "center", flex: 1 }}>
              <Box sx={{ borderTop: "1px solid #000", width: "80%", mx: "auto", pt: 0.5 }}>
                <Typography sx={{ fontSize: "0.6875rem" }}>
                  Issue By : {data.documentInfo?.issueBy || data.issueBy || ""}
                </Typography>
              </Box>
            </Box>
          </Box>
        </Box>

      </Paper>
    );
  }

  // CN / DN - Credit Note / Debit Note Layout (same style as TI2 Invoice)
  if (documentType === "CN" || documentType === "CREDIT_NOTE" || documentType === "DN" || documentType === "DEBIT_NOTE") {
    const isCreditNote = documentType === "CN" || documentType === "CREDIT_NOTE";
    return (
      <Paper
        sx={{
          width: "210mm",
          minHeight: "297mm",
          margin: "0 auto",
          p: "20mm",
          backgroundColor: "white",
          fontFamily: "var(--font-carlito), 'Calibri', 'Arial', sans-serif",
          fontSize: "0.75rem",
          lineHeight: 1.6,
          color: "#000",
          display: "flex",
          flexDirection: "column",
          "@media print": {
            margin: 0,
            padding: "20mm",
            boxShadow: "none",
          },
        }}
      >
        {/* Company Header - Centered */}
        <Box sx={{ textAlign: "center", mb: 2, mt: -6 }}>
          <Typography sx={{ fontSize: "1.125rem", fontWeight: 700, mb: 0.3, letterSpacing: "0.5px" }}>
            {data.company?.name || organization?.name || ""}
          </Typography>
          <Typography sx={{ fontSize: "0.75rem", mb: 0.2 }}>
            GST Reg No: {data.company?.gstRegNo || organization?.registrationNumber || ""}
            {data.company?.coRegNo && ` Co. Reg No: ${data.company.coRegNo}`}
          </Typography>
          <Typography sx={{ fontSize: "0.75rem", mb: 0.2 }}>
            {data.company?.address || organization?.address || ""}
          </Typography>
          <Typography sx={{ fontSize: "0.75rem" }}>
            Tel: {data.company?.phoneNumber || organization?.phoneNumber || ""}
            {data.company?.fax && ` Fax: ${data.company.fax}`}
          </Typography>
        </Box>

        {/* Customer and Note Details Section */}
        <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1, alignItems: "flex-start" }}>
          {/* Left - Bill To and Deliver To Section */}
          <Box sx={{ width: "45%" }}>
            {/* Bill To */}
            <Box sx={{ mb: 3 }}>
              <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, mb: 0.5 }}>Bill To :</Typography>
              <Typography sx={{ fontSize: "0.75rem", fontWeight: 600 }}>
                {data.customer?.name || data.customerName || ""}
              </Typography>
              <Typography sx={{ fontSize: "0.75rem", whiteSpace: "pre-line" }}>
                {data.billTo || data.customer?.address || data.customerAddress || ""}
              </Typography>
            </Box>

            {/* Deliver To - hidden when deliver to address is empty */}
            {data.deliveryTo && (
            <Box>
              <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, mb: 0.5 }}>Deliver To :</Typography>
              <Typography sx={{ fontSize: "0.75rem", whiteSpace: "pre-line" }}>
                {data.deliveryTo}
              </Typography>
              {(data.documentInfo?.contactName || data.documentInfo?.contact || data.contact) && (
                <Typography sx={{ fontSize: "0.75rem" }}>
                  Attn: {data.documentInfo?.contactName || data.documentInfo?.contact || data.contact}
                  {data.documentInfo?.contactNumber ? ` (${data.documentInfo.contactNumber})` : ""}
                </Typography>
              )}
            </Box>
            )}
          </Box>

          {/* Right - Note Details */}
          <Box sx={{ width: "45%", display: "flex", justifyContent: "flex-end", pl: 4 }}>
            <Box sx={{ lineHeight: 1.4 }}>
              {/* Title */}
              <Typography sx={{ fontSize: "1rem", fontWeight: 700, mb: 1 }}>
                {isCreditNote ? "CREDIT NOTE" : "DEBIT NOTE"}
              </Typography>
              <InfoRow label={isCreditNote ? "Credit Note No." : "Debit Note No."} value={data.documentInfo?.documentNumber} />
              <InfoRow label="Date" value={formatDate(data.documentInfo?.date)} />
              <InfoRow label="Customer code" value={data.customer?.customerCode} />
              <InfoRow label="Salesman code" value={data.documentInfo?.salesPerson || data.documentInfo?.salesman} />
              <InfoRow label="Invoice No." value={data.documentInfo?.invoiceNo} />
              <InfoRow label="Delivery Order No." value={data.documentInfo?.doNo} />
              <InfoRow label="Contact Name" value={data.documentInfo?.contactName || data.documentInfo?.contact || data.contact} />
              <InfoRow label="Contact No." value={data.documentInfo?.contactNumber} />
              <InfoRow label="Terms" value={data.documentInfo?.paymentTerms || "0 DAYS"} />
            </Box>
          </Box>
        </Box>

        {/* Items Table */}
        <TableContainer sx={{ mb: 3, mt: 0.5 }}>
          <Table
            sx={{
              "& .MuiTableCell-root": {
                border: "none",
                borderBottom: "none",
                padding: "10px 8px",
                fontSize: "0.6875rem",
              },
              "& .MuiTableHead-root .MuiTableCell-root": {
                border: "none",
                borderBottom: "2px solid #000",
                fontWeight: 600,
                fontSize: "0.6875rem",
              },
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: "55%" }}>Description</TableCell>
                <TableCell sx={{ width: "15%", textAlign: "center" }}>Quantity</TableCell>
                <TableCell sx={{ width: "15%", textAlign: "right" }}>Unit Price</TableCell>
                <TableCell sx={{ width: "15%", textAlign: "right" }}>Amount SGD</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item: any, index: number) => (
                <TableRow key={index}>
                  <TableCell>
                    <Box>
                      <Typography sx={{ fontSize: "0.6875rem", fontWeight: 500, mb: 0.5 }}>
                        {item.description}
                      </Typography>
                      {item.details && (
                        <Box sx={{ pl: 1 }}>
                          {typeof item.details === 'string'
                            ? item.details.split("\n").map((detail: string, idx: number) => (
                                <Typography key={idx} sx={{ fontSize: "0.625rem", color: "#666", lineHeight: 1.4 }}>
                                  {detail}
                                </Typography>
                              ))
                            : <Typography sx={{ fontSize: "0.625rem", color: "#666", lineHeight: 1.4 }}>
                                {item.details}
                              </Typography>}
                        </Box>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell sx={{ textAlign: "center" }}>{item.quantity?.toFixed(2)}</TableCell>
                  <TableCell sx={{ textAlign: "right" }}>{item.unitPrice?.toFixed(2)}</TableCell>
                  <TableCell sx={{ textAlign: "right" }}>{(item.amount || 0).toFixed(2)}</TableCell>
                </TableRow>
              ))}

              {items.length < 5 &&
                Array.from({ length: 5 - items.length }).map((_, index) => (
                  <TableRow key={`empty-${index}`} sx={{ height: 40 }}>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </TableContainer>

        {/* Reason / Remarks */}
        {(data.documentInfo?.reason || data.remarks) && (
          <Box sx={{ mb: 2, fontSize: "0.6875rem" }}>
            <Typography sx={{ fontWeight: 600, mb: 0.5 }}>Reason:</Typography>
            <Typography>{data.documentInfo?.reason || data.remarks || ""}</Typography>
          </Box>
        )}

        {/* Bottom Section Container */}
        <Box sx={{ mt: "auto" }}>
          {/* Totals */}
          {(() => {
            const rate = data.documentInfo?.rate || 1;
            const currency = data.documentInfo?.currency || "SGD";
            const discountPercent = data.documentInfo?.discountPercent || data.documentInfo?.discount || 0;
            const isTaxApplicable = data.documentInfo?.taxApplicable !== 'N' && data.documentInfo?.taxApplicable !== false;
          const gstPercent = isTaxApplicable ? (data.documentInfo?.gstPercent || 9) : 0;

            const grossTotal = subtotal;
            const discountAmount = grossTotal * (discountPercent / 100);
            const subtotalAfterDiscount = grossTotal - discountAmount;
            const gstAmount = subtotalAfterDiscount * (gstPercent / 100);
            const finalTotal = subtotalAfterDiscount + gstAmount;

            return (
              <Box sx={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #000", pt: 1 }}>
                {/* Left Side - Rate, Sub-total, GST summary */}
                <Box sx={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <Box sx={{ display: "flex", alignItems: "center" }}>
                    <Typography sx={{ fontSize: "0.6875rem" }}>(Rate :</Typography>
                    <Typography sx={{ fontSize: "0.6875rem", ml: 1, minWidth: 60 }}>{rate.toFixed(6)}</Typography>
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center" }}>
                    <Typography sx={{ fontSize: "0.6875rem" }}>Sub-total:</Typography>
                    <Typography sx={{ fontSize: "0.6875rem", ml: 1, minWidth: 50, textAlign: "right" }}>{subtotalAfterDiscount.toFixed(2)}</Typography>
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center" }}>
                    <Typography sx={{ fontSize: "0.6875rem" }}>GST</Typography>
                    <Typography sx={{ fontSize: "0.6875rem", ml: 1 }}>:</Typography>
                    <Typography sx={{ fontSize: "0.6875rem", ml: 1, minWidth: 40, textAlign: "right" }}>{gstAmount.toFixed(2)})</Typography>
                  </Box>
                </Box>

                {/* Right Side - Detailed Totals */}
                <Box sx={{ minWidth: 200 }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.3 }}>
                    <Typography sx={{ fontSize: "0.6875rem" }}>Sub-Total</Typography>
                    <Typography sx={{ fontSize: "0.6875rem", textAlign: "right" }}>{grossTotal.toFixed(2)}</Typography>
                  </Box>
                  {discountPercent > 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.3 }}>
                      <Typography sx={{ fontSize: "0.6875rem" }}>Discount</Typography>
                      <Box sx={{ display: "flex", gap: 2 }}>
                        <Typography sx={{ fontSize: "0.6875rem" }}>{discountPercent.toFixed(2)}</Typography>
                        <Typography sx={{ fontSize: "0.6875rem", textAlign: "right", minWidth: 50 }}>{discountAmount.toFixed(2)}</Typography>
                      </Box>
                    </Box>
                  )}
                  {discountPercent > 0 && (
                    <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.3 }}>
                      <Typography sx={{ fontSize: "0.6875rem" }}>Sub-Total</Typography>
                      <Typography sx={{ fontSize: "0.6875rem", textAlign: "right" }}>{subtotalAfterDiscount.toFixed(2)}</Typography>
                    </Box>
                  )}
                  <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.3 }}>
                    <Typography sx={{ fontSize: "0.6875rem" }}>GST</Typography>
                    <Box sx={{ display: "flex", gap: 2 }}>
                      <Typography sx={{ fontSize: "0.6875rem" }}>{gstPercent.toFixed(2)} %</Typography>
                      <Typography sx={{ fontSize: "0.6875rem", textAlign: "right", minWidth: 50 }}>{gstAmount.toFixed(2)}</Typography>
                    </Box>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.3, borderTop: "1px solid #000", mt: 0.5, pt: 0.5 }}>
                    <Typography sx={{ fontSize: "0.6875rem" }}>Total</Typography>
                    <Box sx={{ display: "flex", gap: 2 }}>
                      <Typography sx={{ fontSize: "0.6875rem" }}>{currency}</Typography>
                      <Typography sx={{ fontSize: "0.6875rem", fontWeight: 600, textAlign: "right", minWidth: 50 }}>{finalTotal.toFixed(2)}</Typography>
                    </Box>
                  </Box>
                </Box>
              </Box>
            );
          })()}

          {/* Amount in Words */}
          {(() => {
            const discountPercent = data.documentInfo?.discountPercent || data.documentInfo?.discount || 0;
            const isTaxApplicable = data.documentInfo?.taxApplicable !== 'N' && data.documentInfo?.taxApplicable !== false;
          const gstPercent = isTaxApplicable ? (data.documentInfo?.gstPercent || 9) : 0;
            const grossTotal = subtotal;
            const discountAmount = grossTotal * (discountPercent / 100);
            const subtotalAfterDiscount = grossTotal - discountAmount;
            const gstAmount = subtotalAfterDiscount * (gstPercent / 100);
            const finalTotal = subtotalAfterDiscount + gstAmount;

            const numberToWords = (num: number): string => {
              const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
                'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
              const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
              if (num === 0) return 'ZERO';
              const convertHundreds = (n: number): string => {
                let str = '';
                if (n >= 100) { str += ones[Math.floor(n / 100)] + ' HUNDRED '; n %= 100; }
                if (n >= 20) { str += tens[Math.floor(n / 10)] + ' '; n %= 10; }
                if (n > 0) { str += ones[n] + ' '; }
                return str;
              };
              let result = '';
              const dollars = Math.floor(num);
              const cents = Math.round((num - dollars) * 100);
              if (dollars >= 1000) { result += convertHundreds(Math.floor(dollars / 1000)) + 'THOUSAND '; }
              result += convertHundreds(dollars % 1000);
              if (cents > 0) { result += 'AND CENTS ' + convertHundreds(cents); }
              return result.trim() + ' ONLY.';
            };

            return (
              <Box sx={{ mt: 2, borderBottom: "2px solid #000", pb: 1 }}>
                <Typography sx={{ fontSize: "0.6875rem", fontWeight: 500 }}>
                  S'PORE DOLLAR {numberToWords(finalTotal)}
                </Typography>
              </Box>
            );
          })()}

          {/* Footer - Due Date, Bank Details & Computer Generated Notice */}
          <Box sx={{ mt: 2, borderTop: "2px solid #000", pt: 1.5 }}>
            {/* Due Date */}
            {(() => {
              const invoiceDate = data.documentInfo?.date;
              const terms = data.documentInfo?.paymentTerms;
              const termDays = parseInt(String(terms).replace(/\D/g, '')) || 0;
              if (invoiceDate && termDays > 0) {
                const due = new Date(invoiceDate);
                due.setDate(due.getDate() + termDays);
                const formatted = due.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                return (
                  <Typography sx={{ fontSize: "0.6875rem", fontWeight: 700, mb: 0.5 }}>
                    Due Date: {formatted}
                  </Typography>
                );
              }
              return null;
            })()}
          <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2 }}>
            {/* Left - Bank Details from Organization */}
            <Box sx={{ flex: 1, maxWidth: "55%" }}>
              {(() => {
                const bank = organization?.bankDetails;
                const hasBank = bank && (bank.accountName || bank.accountNumber || bank.bankName);
                return (
                  <>
                    {hasBank && (
                      <Box sx={{ fontSize: "0.5625rem", lineHeight: 1.6 }}>
                        {bank.accountName && <Typography sx={{ fontSize: "0.5625rem" }}>All Cheque should be crossed and made payable to: {bank.accountName}</Typography>}
                        {bank.bankName && <Typography sx={{ fontSize: "0.5625rem" }}>By Bank Transfer: {bank.bankName}</Typography>}
                        {bank.branchCode && <Typography sx={{ fontSize: "0.5625rem" }}>Branch: {bank.branchCode}</Typography>}
                        {(bank.bankCode || bank.swiftCode) && <Typography sx={{ fontSize: "0.5625rem" }}>Bank Branch No.: {bank.bankCode || ""}{bank.swiftCode ? ` Swift Code: ${bank.swiftCode}` : ""}</Typography>}
                        {bank.accountNumber && <Typography sx={{ fontSize: "0.5625rem" }}>Bank Account No.: {bank.accountNumber}</Typography>}
                        {organization?.registrationNumber && <Typography sx={{ fontSize: "0.5625rem" }}>PayNow to UEN: {organization.registrationNumber}</Typography>}
                      </Box>
                    )}
                    {!hasBank && <Typography sx={{ fontSize: "0.5625rem" }}>&nbsp;</Typography>}
                  </>
                );
              })()}
            </Box>

            {/* Right - Computer generated notice */}
            <Box sx={{ textAlign: "right" }}>
              <Typography sx={{ fontSize: "0.6875rem", fontStyle: "italic" }}>
                This is a computer generated {isCreditNote ? "Credit Note" : "Debit Note"}.
              </Typography>
              <Typography sx={{ fontSize: "0.6875rem", fontStyle: "italic" }}>
                No signature is required.
              </Typography>
            </Box>
          </Box>

          {/* Notes & T&C side by side */}
          {(data.note || data.termsAndConditions) && (
            <Box sx={{ display: "flex", gap: 2, mt: 1 }}>
              {data.note && (
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontSize: "0.5625rem", fontWeight: 600 }}>Note:</Typography>
                  <Typography sx={{ fontSize: "0.5625rem", lineHeight: 1.6, whiteSpace: "pre-line" }}>{data.note}</Typography>
                </Box>
              )}
              {data.termsAndConditions && (
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontSize: "0.5625rem", fontWeight: 600 }}>Terms & Conditions:</Typography>
                  <Typography sx={{ fontSize: "0.5625rem", lineHeight: 1.6, whiteSpace: "pre-line" }}>{data.termsAndConditions}</Typography>
                </Box>
              )}
            </Box>
          )}
          </Box>
        </Box>

      </Paper>
    );
  }

  // PO - Purchase Order Layout (same style as TI2)
  if (documentType === "PO" || documentType === "PURCHASE_ORDER" || documentType === "PR" || documentType === "PURCHASE_RETURN") {
    const isPR = documentType === "PR" || documentType === "PURCHASE_RETURN";
    return (
      <Paper
        sx={{
          width: "210mm",
          minHeight: "297mm",
          margin: "0 auto",
          p: "20mm",
          backgroundColor: "white",
          fontFamily: "var(--font-carlito), 'Calibri', 'Arial', sans-serif",
          fontSize: "0.75rem",
          lineHeight: 1.6,
          color: "#000",
          display: "flex",
          flexDirection: "column",
          "@media print": {
            margin: 0,
            padding: "20mm",
            boxShadow: "none",
          },
        }}
      >
        {/* Company Header - Centered */}
        <Box sx={{ textAlign: "center", mb: 2, mt: -6 }}>
          <Typography sx={{ fontSize: "1.125rem", fontWeight: 700, mb: 0.3, letterSpacing: "0.5px" }}>
            {data.company?.name || organization?.name || ""}
          </Typography>
          <Typography sx={{ fontSize: "0.75rem", mb: 0.2 }}>
            Co. Reg No. : {data.company?.coRegNo || ""}
            {" "}GST Reg No: {data.company?.gstRegNo || organization?.registrationNumber || ""}
          </Typography>
          <Typography sx={{ fontSize: "0.75rem" }}>
            Tel: {data.company?.phoneNumber || organization?.phoneNumber || ""}
            {data.company?.fax && ` Fax: ${data.company.fax}`}
          </Typography>
        </Box>

        {/* Supplier and PO Details Section */}
        <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1, alignItems: "flex-start" }}>
          {/* Left - Supplier Info */}
          <Box sx={{ width: "45%" }}>
            <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, mb: 0.5 }}>To :</Typography>
            <Typography sx={{ fontSize: "0.75rem", fontWeight: 600 }}>
              {data.supplier?.name || data.documentInfo?.supplierName || data.customer?.name || data.customerName || ""}
            </Typography>
            <Typography sx={{ fontSize: "0.75rem", whiteSpace: "pre-line" }}>
              {data.supplier?.address || data.documentInfo?.supplierAddress || data.customer?.address || data.customerAddress || ""}
            </Typography>
            {(data.documentInfo?.contactName || data.documentInfo?.contact || data.contact) && (
              <Box sx={{ mt: 1 }}>
                <Typography sx={{ fontSize: "0.75rem" }}>
                  ATTN : {data.documentInfo?.contactName || data.documentInfo?.contact || data.contact}
                  {data.documentInfo?.contactNumber ? ` (${data.documentInfo.contactNumber})` : ""}
                </Typography>
              </Box>
            )}
          </Box>

          {/* Right - PO Details */}
          <Box sx={{ width: "45%", display: "flex", justifyContent: "flex-end", pl: 4 }}>
            <Box sx={{ lineHeight: 1.4 }}>
              {/* Purchase Order Title */}
              <Typography sx={{ fontSize: "1rem", fontWeight: 700, mb: 1 }}>
                {isPR ? "PURCHASE RETURN" : "PURCHASE ORDER"}
              </Typography>
              <InfoRow label="P/O NO." value={data.documentInfo?.documentNumber || data.name} />
              <InfoRow label="Date" value={formatDate(data.documentInfo?.date)} />
              <InfoRow label="Our Reference" value={data.documentInfo?.referenceNo} />
              <InfoRow label="Delivery Date" value={formatDate(data.documentInfo?.deliveryDate)} />
              <InfoRow label="Terms" value={data.documentInfo?.paymentTerms || "60 DAYS"} />
              <InfoRow label="Currency" value={data.documentInfo?.currency || "SGD"} />
            </Box>
          </Box>
        </Box>

        {/* Items Table */}
        <TableContainer sx={{ mb: 3, mt: 0.5 }}>
          <Table
            sx={{
              "& .MuiTableCell-root": {
                border: "none",
                borderBottom: "none",
                padding: "10px 8px",
                fontSize: "0.6875rem",
              },
              "& .MuiTableHead-root .MuiTableCell-root": {
                border: "none",
                borderBottom: "2px solid #000",
                fontWeight: 600,
                fontSize: "0.6875rem",
              },
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: "5%" }}>Item</TableCell>
                <TableCell sx={{ width: "40%" }}>Description</TableCell>
                <TableCell sx={{ width: "12%", textAlign: "center" }}>Quantity</TableCell>
                <TableCell sx={{ width: "10%", textAlign: "center" }}>uom</TableCell>
                <TableCell sx={{ width: "15%", textAlign: "right" }}>Unit-Price</TableCell>
                <TableCell sx={{ width: "18%", textAlign: "right" }}>Amount</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item: any, index: number) => (
                <TableRow key={index}>
                  <TableCell>{index + 1}</TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: "0.6875rem" }}>
                      {item.description}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ textAlign: "center" }}>{item.quantity?.toFixed(2)}</TableCell>
                  <TableCell sx={{ textAlign: "center" }}>{item.uom || ""}</TableCell>
                  <TableCell sx={{ textAlign: "right" }}>{item.unitPrice?.toFixed(4)}</TableCell>
                  <TableCell sx={{ textAlign: "right" }}>{(item.amount || 0).toFixed(2)}</TableCell>
                </TableRow>
              ))}

              {/* Add empty rows for spacing */}
              {items.length < 5 &&
                Array.from({ length: 5 - items.length }).map((_, index) => (
                  <TableRow key={`empty-${index}`} sx={{ height: 40 }}>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </TableContainer>

        {/* Bottom Section Container - Pushed to bottom of page */}
        <Box sx={{ mt: "auto" }}>
          {/* Totals - Right aligned */}
          {(() => {
            const currency = data.documentInfo?.currency || "SGD";
            const isTaxApplicable = data.documentInfo?.taxApplicable !== 'N' && data.documentInfo?.taxApplicable !== false;
          const gstPercent = isTaxApplicable ? (data.documentInfo?.gstPercent || 9) : 0;
            const isAbsorbTax = data.documentInfo?.absorbTax === 'Y' || data.documentInfo?.absorbTax === true;
            const grossTotal = subtotal;
            const gstAmount = isAbsorbTax && gstPercent > 0
              ? grossTotal * gstPercent / (100 + gstPercent)
              : grossTotal * (gstPercent / 100);
            const finalTotal = isAbsorbTax ? grossTotal : grossTotal + gstAmount;

            return (
              <>
                <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                  <Box sx={{ minWidth: 250 }}>
                    <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.3 }}>
                      <Typography sx={{ fontSize: "0.6875rem" }}>SUB-TOTAL</Typography>
                      <Typography sx={{ fontSize: "0.6875rem", textAlign: "right" }}>{grossTotal.toFixed(2)}</Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.3 }}>
                      <Typography sx={{ fontSize: "0.6875rem" }}>GST</Typography>
                      <Box sx={{ display: "flex", gap: 2 }}>
                        <Typography sx={{ fontSize: "0.6875rem" }}>{gstPercent.toFixed(2)} %</Typography>
                        <Typography sx={{ fontSize: "0.6875rem", textAlign: "right", minWidth: 60 }}>{gstAmount.toFixed(2)}</Typography>
                      </Box>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.3, borderTop: "1px solid #000", mt: 0.5, pt: 0.5 }}>
                      <Typography sx={{ fontSize: "0.6875rem" }}>TOTAL</Typography>
                      <Box sx={{ display: "flex", gap: 2 }}>
                        <Typography sx={{ fontSize: "0.6875rem" }}>{currency}</Typography>
                        <Typography sx={{ fontSize: "0.6875rem", fontWeight: 600, textAlign: "right", minWidth: 60 }}>{finalTotal.toFixed(2)}</Typography>
                      </Box>
                    </Box>
                  </Box>
                </Box>

                {/* Amount in Words */}
                <Box sx={{ mt: 2, borderBottom: "2px solid #000", pb: 1 }}>
                  <Typography sx={{ fontSize: "0.6875rem", fontWeight: 500 }}>
                    S'PORE DOLLAR {(() => {
                      const numberToWords = (num: number): string => {
                        const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
                          'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
                        const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
                        if (num === 0) return 'ZERO';
                        const convertHundreds = (n: number): string => {
                          let str = '';
                          if (n >= 100) { str += ones[Math.floor(n / 100)] + ' HUNDRED '; n %= 100; }
                          if (n >= 20) { str += tens[Math.floor(n / 10)] + ' '; n %= 10; }
                          if (n > 0) { str += ones[n] + ' '; }
                          return str;
                        };
                        let result = '';
                        const dollars = Math.floor(num);
                        const cents = Math.round((num - dollars) * 100);
                        if (dollars >= 1000000) { result += convertHundreds(Math.floor(dollars / 1000000)) + 'MILLION '; }
                        if (dollars >= 1000) { result += convertHundreds(Math.floor((dollars % 1000000) / 1000)) + 'THOUSAND '; }
                        result += convertHundreds(dollars % 1000);
                        if (cents > 0) { result += 'AND CENTS ' + convertHundreds(cents); }
                        return result.trim() + ' ONLY.';
                      };
                      return numberToWords(finalTotal);
                    })()}
                  </Typography>
                </Box>

                {/* Signature Section */}
                <Box sx={{ display: "flex", justifyContent: "space-between", mt: 4, gap: 2 }}>
                  <Box sx={{ flex: 1, textAlign: "center" }}>
                    <Typography sx={{ fontSize: "0.625rem", mb: 0.5 }}>PREPARE BY :</Typography>
                    <Box sx={{ borderBottom: "1px solid #000", mb: 0.5, minHeight: 40 }} />
                    <Typography sx={{ fontSize: "0.625rem", fontWeight: 600 }}>PURCHASER</Typography>
                  </Box>
                  <Box sx={{ flex: 1, textAlign: "center" }}>
                    <Typography sx={{ fontSize: "0.625rem", mb: 0.5 }}>CHECKED BY</Typography>
                    <Box sx={{ borderBottom: "1px solid #000", mb: 0.5, minHeight: 40 }} />
                    <Typography sx={{ fontSize: "0.625rem", fontWeight: 600 }}>SENIOR PURCHASER</Typography>
                  </Box>
                  <Box sx={{ flex: 1, textAlign: "center" }}>
                    <Typography sx={{ fontSize: "0.625rem", mb: 0.5 }}>APPROVED BY</Typography>
                    <Box sx={{ borderBottom: "1px solid #000", mb: 0.5, minHeight: 40 }} />
                    <Typography sx={{ fontSize: "0.625rem", fontWeight: 600 }}>SENIOR OPERATIONAL MANAGER</Typography>
                  </Box>
                  <Box sx={{ flex: 1, textAlign: "center" }}>
                    <Typography sx={{ fontSize: "0.625rem", mb: 0.5 }}>ACKNOWLEDGE BY :</Typography>
                    <Box sx={{ borderBottom: "1px solid #000", mb: 0.5, minHeight: 40 }} />
                    <Typography sx={{ fontSize: "0.625rem", fontWeight: 600 }}>VENDOR</Typography>
                  </Box>
                </Box>

                {/* Thank You message */}
                <Typography sx={{ fontSize: "0.625rem", mt: 1 }}>
                  THANK YOU FOR YOUR RECENT PURCHASE
                </Typography>

              </>
            );
          })()}
        </Box>

      </Paper>
    );
  }

  // SAI / SAO - Stock Adjustment In / Out Layout (same style as PO)
  if (documentType === "SAI" || documentType === "STOCK_ADJUSTMENT_IN" || documentType === "SAO" || documentType === "STOCK_ADJUSTMENT_OUT") {
    const isOut = documentType === "SAO" || documentType === "STOCK_ADJUSTMENT_OUT";
    return (
      <Paper
        sx={{
          width: "210mm",
          minHeight: "297mm",
          margin: "0 auto",
          p: "20mm",
          backgroundColor: "white",
          fontFamily: "var(--font-carlito), 'Calibri', 'Arial', sans-serif",
          fontSize: "0.75rem",
          lineHeight: 1.6,
          color: "#000",
          display: "flex",
          flexDirection: "column",
          "@media print": {
            margin: 0,
            padding: "20mm",
            boxShadow: "none",
          },
        }}
      >
        {/* Company Header - Centered */}
        <Box sx={{ textAlign: "center", mb: 2, mt: -6 }}>
          <Typography sx={{ fontSize: "1.125rem", fontWeight: 700, mb: 0.3, letterSpacing: "0.5px" }}>
            {data.company?.name || organization?.name || ""}
          </Typography>
          <Typography sx={{ fontSize: "0.75rem", mb: 0.2 }}>
            Co. Reg No. : {data.company?.coRegNo || ""}
            {" "}GST Reg No: {data.company?.gstRegNo || organization?.registrationNumber || ""}
          </Typography>
          <Typography sx={{ fontSize: "0.75rem" }}>
            Tel: {data.company?.phoneNumber || organization?.phoneNumber || ""}
            {data.company?.fax && ` Fax: ${data.company.fax}`}
          </Typography>
        </Box>

        {/* To and Document Details Section */}
        <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1, alignItems: "flex-start" }}>
          {/* Left - To Info */}
          <Box sx={{ width: "45%" }}>
            <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, mb: 0.5 }}>To :</Typography>
            <Typography sx={{ fontSize: "0.75rem", fontWeight: 600 }}>
              {data.customer?.name || data.customerName || ""}{(data.customer?.customerCode || data.customerCode) ? ` (${data.customer?.customerCode || data.customerCode})` : ""}
            </Typography>
            <Typography sx={{ fontSize: "0.75rem", whiteSpace: "pre-line" }}>
              {data.customer?.address || data.customerAddress || ""}
            </Typography>
            {(data.documentInfo?.contactName || data.documentInfo?.contact || data.contact) && (
              <Box sx={{ mt: 1 }}>
                <Typography sx={{ fontSize: "0.75rem" }}>
                  ATTN : {data.documentInfo?.contactName || data.documentInfo?.contact || data.contact}
                  {data.documentInfo?.contactNumber ? ` (${data.documentInfo.contactNumber})` : ""}
                </Typography>
              </Box>
            )}
          </Box>

          {/* Right - Document Details */}
          <Box sx={{ width: "45%", display: "flex", justifyContent: "flex-end", pl: 4 }}>
            <Box sx={{ lineHeight: 1.4 }}>
              <Typography sx={{ fontSize: "1rem", fontWeight: 700, mb: 1 }}>
                {isOut ? "STOCK ADJUSTMENT OUT" : "STOCK ADJUSTMENT IN"}
              </Typography>
              <InfoRow label="Doc No." value={data.documentInfo?.documentNumber || data.name} />
              <InfoRow label="Date" value={formatDate(data.documentInfo?.date)} />
              <InfoRow label="Our Reference" value={data.documentInfo?.referenceNo} />
              <InfoRow label="Delivery Date" value={formatDate(data.documentInfo?.deliveryDate)} />
              <InfoRow label="Terms" value={data.documentInfo?.paymentTerms} />
              <InfoRow label="Currency" value={data.documentInfo?.currency || "SGD"} />
            </Box>
          </Box>
        </Box>

        {/* Items Table */}
        <TableContainer sx={{ mb: 3, mt: 0.5 }}>
          <Table
            sx={{
              "& .MuiTableCell-root": {
                border: "none",
                borderBottom: "none",
                padding: "10px 8px",
                fontSize: "0.6875rem",
              },
              "& .MuiTableHead-root .MuiTableCell-root": {
                border: "none",
                borderBottom: "2px solid #000",
                fontWeight: 600,
                fontSize: "0.6875rem",
              },
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: "5%" }}>Item</TableCell>
                <TableCell sx={{ width: "40%" }}>Description</TableCell>
                <TableCell sx={{ width: "12%", textAlign: "center" }}>Quantity</TableCell>
                <TableCell sx={{ width: "10%", textAlign: "center" }}>uom</TableCell>
                <TableCell sx={{ width: "15%", textAlign: "right" }}>Unit-Price</TableCell>
                <TableCell sx={{ width: "18%", textAlign: "right" }}>Amount</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item: any, index: number) => (
                <TableRow key={index}>
                  <TableCell>{index + 1}</TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: "0.6875rem" }}>
                      {item.description}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ textAlign: "center" }}>{item.quantity?.toFixed(2)}</TableCell>
                  <TableCell sx={{ textAlign: "center" }}>{item.uom || ""}</TableCell>
                  <TableCell sx={{ textAlign: "right" }}>{item.unitPrice?.toFixed(4)}</TableCell>
                  <TableCell sx={{ textAlign: "right" }}>{(item.amount || 0).toFixed(2)}</TableCell>
                </TableRow>
              ))}

              {items.length < 5 &&
                Array.from({ length: 5 - items.length }).map((_, index) => (
                  <TableRow key={`empty-${index}`} sx={{ height: 40 }}>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </TableContainer>

        {/* Bottom Section Container - Pushed to bottom of page */}
        <Box sx={{ mt: "auto" }}>
          {/* Totals - Right aligned */}
          {(() => {
            const currency = data.documentInfo?.currency || "SGD";
            const isTaxApplicable = data.documentInfo?.taxApplicable !== 'N' && data.documentInfo?.taxApplicable !== false;
          const gstPercent = isTaxApplicable ? (data.documentInfo?.gstPercent || 9) : 0;
            const isAbsorbTax = data.documentInfo?.absorbTax === 'Y' || data.documentInfo?.absorbTax === true;
            const grossTotal = subtotal;
            const gstAmount = isAbsorbTax && gstPercent > 0
              ? grossTotal * gstPercent / (100 + gstPercent)
              : grossTotal * (gstPercent / 100);
            const finalTotal = isAbsorbTax ? grossTotal : grossTotal + gstAmount;

            return (
              <>
                <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                  <Box sx={{ minWidth: 250 }}>
                    <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.3 }}>
                      <Typography sx={{ fontSize: "0.6875rem" }}>SUB-TOTAL</Typography>
                      <Typography sx={{ fontSize: "0.6875rem", textAlign: "right" }}>{grossTotal.toFixed(2)}</Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.3 }}>
                      <Typography sx={{ fontSize: "0.6875rem" }}>GST</Typography>
                      <Box sx={{ display: "flex", gap: 2 }}>
                        <Typography sx={{ fontSize: "0.6875rem" }}>{gstPercent.toFixed(2)} %</Typography>
                        <Typography sx={{ fontSize: "0.6875rem", textAlign: "right", minWidth: 60 }}>{gstAmount.toFixed(2)}</Typography>
                      </Box>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.3, borderTop: "1px solid #000", mt: 0.5, pt: 0.5 }}>
                      <Typography sx={{ fontSize: "0.6875rem" }}>TOTAL</Typography>
                      <Box sx={{ display: "flex", gap: 2 }}>
                        <Typography sx={{ fontSize: "0.6875rem" }}>{currency}</Typography>
                        <Typography sx={{ fontSize: "0.6875rem", fontWeight: 600, textAlign: "right", minWidth: 60 }}>{finalTotal.toFixed(2)}</Typography>
                      </Box>
                    </Box>
                  </Box>
                </Box>

                {/* Amount in Words */}
                <Box sx={{ mt: 2, borderBottom: "2px solid #000", pb: 1 }}>
                  <Typography sx={{ fontSize: "0.6875rem", fontWeight: 500 }}>
                    S'PORE DOLLAR {(() => {
                      const numberToWords = (num: number): string => {
                        const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
                          'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
                        const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
                        if (num === 0) return 'ZERO';
                        const convertHundreds = (n: number): string => {
                          let str = '';
                          if (n >= 100) { str += ones[Math.floor(n / 100)] + ' HUNDRED '; n %= 100; }
                          if (n >= 20) { str += tens[Math.floor(n / 10)] + ' '; n %= 10; }
                          if (n > 0) { str += ones[n] + ' '; }
                          return str;
                        };
                        let result = '';
                        const dollars = Math.floor(num);
                        const cents = Math.round((num - dollars) * 100);
                        if (dollars >= 1000000) { result += convertHundreds(Math.floor(dollars / 1000000)) + 'MILLION '; }
                        if (dollars >= 1000) { result += convertHundreds(Math.floor((dollars % 1000000) / 1000)) + 'THOUSAND '; }
                        result += convertHundreds(dollars % 1000);
                        if (cents > 0) { result += 'AND CENTS ' + convertHundreds(cents); }
                        return result.trim() + ' ONLY.';
                      };
                      return numberToWords(finalTotal);
                    })()}
                  </Typography>
                </Box>

                {/* Signature Section */}
                <Box sx={{ display: "flex", justifyContent: "space-between", mt: 4, gap: 2 }}>
                  <Box sx={{ flex: 1, textAlign: "center" }}>
                    <Typography sx={{ fontSize: "0.625rem", mb: 0.5 }}>PREPARE BY :</Typography>
                    <Box sx={{ borderBottom: "1px solid #000", mb: 0.5, minHeight: 40 }} />
                    <Typography sx={{ fontSize: "0.625rem", fontWeight: 600 }}>PURCHASER</Typography>
                  </Box>
                  <Box sx={{ flex: 1, textAlign: "center" }}>
                    <Typography sx={{ fontSize: "0.625rem", mb: 0.5 }}>CHECKED BY</Typography>
                    <Box sx={{ borderBottom: "1px solid #000", mb: 0.5, minHeight: 40 }} />
                    <Typography sx={{ fontSize: "0.625rem", fontWeight: 600 }}>SENIOR PURCHASER</Typography>
                  </Box>
                  <Box sx={{ flex: 1, textAlign: "center" }}>
                    <Typography sx={{ fontSize: "0.625rem", mb: 0.5 }}>APPROVED BY</Typography>
                    <Box sx={{ borderBottom: "1px solid #000", mb: 0.5, minHeight: 40 }} />
                    <Typography sx={{ fontSize: "0.625rem", fontWeight: 600 }}>SENIOR OPERATIONAL MANAGER</Typography>
                  </Box>
                  <Box sx={{ flex: 1, textAlign: "center" }}>
                    <Typography sx={{ fontSize: "0.625rem", mb: 0.5 }}>ACKNOWLEDGE BY :</Typography>
                    <Box sx={{ borderBottom: "1px solid #000", mb: 0.5, minHeight: 40 }} />
                    <Typography sx={{ fontSize: "0.625rem", fontWeight: 600 }}>VENDOR</Typography>
                  </Box>
                </Box>

                {/* Thank You message */}
                <Typography sx={{ fontSize: "0.625rem", mt: 1 }}>
                  THANK YOU FOR YOUR RECENT PURCHASE
                </Typography>

              </>
            );
          })()}
        </Box>

      </Paper>
    );
  }

  // QO1 / QO2 - Quotation Layout
  if (documentType === "QO1" || documentType === "QO2" || documentType === "QO" || documentType === "QUOTATION") {
    // Calculate totals with discount
    const discountAmount = data.documentInfo?.discountAmount || 0;
    const subtotalAfterDiscount = subtotal - discountAmount;
    const currency = data.documentInfo?.currency || "SGD";

    // Number to words function
    const numberToWords = (num: number): string => {
      if (num === 0) return 'ZERO';
      const isNegative = num < 0;
      num = Math.abs(num);

      const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
        'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
      const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];

      const convertHundreds = (n: number): string => {
        let str = '';
        if (n >= 100) { str += ones[Math.floor(n / 100)] + ' HUNDRED '; n %= 100; }
        if (n >= 20) { str += tens[Math.floor(n / 10)] + ' '; n %= 10; }
        if (n > 0) { str += ones[n] + ' '; }
        return str;
      };

      let result = isNegative ? 'NEGATIVE ' : '';
      const dollars = Math.floor(num);
      const cents = Math.round((num - dollars) * 100);

      if (dollars >= 1000000000000) {
        result += convertHundreds(Math.floor(dollars / 1000000000000)) + 'TRILLION ';
      }
      if (dollars >= 1000000000) {
        result += convertHundreds(Math.floor((dollars % 1000000000000) / 1000000000)) + 'BILLION ';
      }
      if (dollars >= 1000000) {
        result += convertHundreds(Math.floor((dollars % 1000000000) / 1000000)) + 'MILLION ';
      }
      if (dollars >= 1000) {
        result += convertHundreds(Math.floor((dollars % 1000000) / 1000)) + 'THOUSAND ';
      }
      result += convertHundreds(dollars % 1000);

      if (cents > 0) {
        result += 'AND CENTS ' + convertHundreds(cents);
      }

      return "S'PORE DOLLAR " + result.trim() + ' ONLY.';
    };

    return (
      <Paper
        sx={{
          width: "210mm",
          minHeight: "297mm",
          margin: "0 auto",
          p: "20mm",
          backgroundColor: "white",
          fontFamily: "var(--font-carlito), 'Calibri', 'Arial', sans-serif",
          fontSize: "0.75rem",
          lineHeight: 1.6,
          color: "#000",
          display: "flex",
          flexDirection: "column",
          "@media print": {
            margin: 0,
            padding: "20mm",
            boxShadow: "none",
          },
        }}
      >
        {/* Company Header - Centered */}
        <Box sx={{ textAlign: "center", mb: 2, mt: -6 }}>
          <Typography sx={{ fontSize: "1.125rem", fontWeight: 700, mb: 0.3, letterSpacing: "0.5px" }}>
            {data.company?.name || organization?.name || ""}
          </Typography>
          <Typography sx={{ fontSize: "0.75rem", mb: 0.2 }}>
            GST Reg No: {data.company?.gstRegNo || organization?.registrationNumber || ""}
            {data.company?.coRegNo && ` Co. Reg No. : ${data.company.coRegNo}`}
          </Typography>
          <Typography sx={{ fontSize: "0.75rem", mb: 0.2 }}>
            {data.company?.address || organization?.address || ""}
          </Typography>
          <Typography sx={{ fontSize: "0.75rem" }}>
            Tel: {data.company?.phoneNumber || organization?.phoneNumber || ""}
            {data.company?.fax && ` Fax: ${data.company.fax}`}
          </Typography>
        </Box>

        {/* Customer and Quotation Details Section */}
        <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1, alignItems: "flex-start" }}>
          {/* Left - To Section */}
          <Box sx={{ width: "45%", border: "1px solid #000", p: 1.5 }}>
            <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, mb: 0.5 }}>To :</Typography>
            <Typography sx={{ fontSize: "0.75rem", fontWeight: 600 }}>
              {data.customer?.name || data.customerName || ""}
            </Typography>
            <Typography sx={{ fontSize: "0.75rem", whiteSpace: "pre-line" }}>
              {data.billTo || data.customer?.address || data.customerAddress || ""}
            </Typography>
          </Box>

          {/* Right - Quotation Details */}
          <Box sx={{ width: "45%", display: "flex", justifyContent: "flex-end", pl: 4 }}>
            <Box sx={{ lineHeight: 1.4 }}>
              {/* Quotation Title */}
              <Typography sx={{ fontSize: "1rem", fontWeight: 700, mb: 1 }}>
                QUOTATION
              </Typography>
              <InfoRow label="NPWP No." value={data.customer?.gstRegNo || data.company?.gstRegNo || organization?.registrationNumber} minWidth="110px" />
              <Box sx={{ display: "flex" }}>
                <Typography sx={{ fontSize: "0.75rem", minWidth: "110px", lineHeight: 1.4, fontWeight: 600 }}>QUOTATION NO.</Typography>
                <Typography sx={{ fontSize: "0.75rem", ml: 0.5, mr: 1, lineHeight: 1.4 }}></Typography>
                <Typography sx={{ fontSize: "0.75rem", flex: 1, lineHeight: 1.4, fontWeight: 600 }}>{data.documentInfo?.documentNumber || ""}</Typography>
              </Box>
              <InfoRow label="Date" value={formatDate(data.documentInfo?.date)} minWidth="110px" />
              <InfoRow label="Your Ref" value={data.documentInfo?.referenceNo} minWidth="110px" />
              <InfoRow label="Terms" value={data.documentInfo?.paymentTerms} minWidth="110px" />
              <InfoRow label="Customer" value={data.customer?.customerCode || data.customerCode} minWidth="110px" />
            </Box>
          </Box>
        </Box>

        {/* Attention Line */}
        {(data.documentInfo?.contactName || data.documentInfo?.contact || data.attention?.name) && (
          <Box sx={{ mb: 1 }}>
            <Typography sx={{ fontSize: "0.75rem", fontWeight: 600 }}>
              Attn : {data.documentInfo?.contactName || data.documentInfo?.contact || data.attention?.name}
              {data.documentInfo?.contactNumber ? ` (${data.documentInfo.contactNumber})` : ""}
            </Typography>
          </Box>
        )}

        {/* Intro Text */}
        <Typography sx={{ fontSize: "0.75rem", mb: 2 }}>
          We are pleased to quote you herewith the following items required by you. They are ;-
        </Typography>

        {/* Items Table */}
        <TableContainer sx={{ mb: 3 }}>
          <Table
            sx={{
              "& .MuiTableCell-root": {
                border: "none",
                borderBottom: "none",
                padding: "6px 8px",
                fontSize: "0.6875rem",
              },
              "& .MuiTableHead-root .MuiTableCell-root": {
                border: "none",
                borderBottom: "2px solid #000",
                fontWeight: 600,
                fontSize: "0.6875rem",
              },
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: "5%" }}>Item</TableCell>
                <TableCell sx={{ width: "40%" }}>Description</TableCell>
                <TableCell sx={{ width: "12%", textAlign: "center" }}>Quantity</TableCell>
                <TableCell sx={{ width: "10%", textAlign: "center" }}>uom</TableCell>
                <TableCell sx={{ width: "15%", textAlign: "right" }}>Unit-Price</TableCell>
                <TableCell sx={{ width: "18%", textAlign: "right" }}>Amount</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item: any, index: number) => (
                <TableRow key={index}>
                  <TableCell>{index + 1}</TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: "0.6875rem", fontWeight: 500 }}>
                      {item.itemCode || item.code || ""}
                    </Typography>
                    <Typography sx={{ fontSize: "0.6875rem" }}>
                      {item.description}
                    </Typography>
                    {item.details && (
                      <Typography sx={{ fontSize: "0.625rem", color: "#666" }}>
                        {item.details}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ textAlign: "center" }}>{item.quantity?.toLocaleString()}</TableCell>
                  <TableCell sx={{ textAlign: "center" }}>{item.uom || ""}</TableCell>
                  <TableCell sx={{ textAlign: "right" }}>{item.unitPrice?.toFixed(2)}</TableCell>
                  <TableCell sx={{ textAlign: "right" }}>{(item.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                </TableRow>
              ))}

              {items.length < 8 &&
                Array.from({ length: 8 - items.length }).map((_, index) => (
                  <TableRow key={`empty-${index}`} sx={{ height: 35 }}>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                    <TableCell>&nbsp;</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </TableContainer>

        {/* Bottom Section - Pushed to bottom */}
        <Box sx={{ mt: "auto" }}>
          {/* Totals - Right aligned */}
          <Box sx={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid #000", pt: 1 }}>
            <Box sx={{ minWidth: 200 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.3 }}>
                <Typography sx={{ fontSize: "0.6875rem" }}>Sub-Total</Typography>
                <Typography sx={{ fontSize: "0.6875rem", textAlign: "right" }}>{subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Typography>
              </Box>
              {discountAmount > 0 && (
                <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.3 }}>
                  <Typography sx={{ fontSize: "0.6875rem" }}>Discount</Typography>
                  <Typography sx={{ fontSize: "0.6875rem", textAlign: "right" }}>{discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Typography>
                </Box>
              )}
              <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.3, borderTop: "1px solid #000", mt: 0.5, pt: 0.5 }}>
                <Typography sx={{ fontSize: "0.6875rem" }}>Total</Typography>
                <Box sx={{ display: "flex", gap: 1 }}>
                  <Typography sx={{ fontSize: "0.6875rem" }}>{currency}</Typography>
                  <Typography sx={{ fontSize: "0.6875rem", fontWeight: 600, textAlign: "right" }}>{subtotalAfterDiscount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Typography>
                </Box>
              </Box>
            </Box>
          </Box>

          {/* Amount in Words */}
          <Box sx={{ mt: 2, mb: 2 }}>
            <Typography sx={{ fontSize: "0.6875rem" }}>
              {numberToWords(subtotalAfterDiscount)}
            </Typography>
          </Box>

          {/* Terms Section */}
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: "flex", mb: 0.3 }}>
              <Typography sx={{ fontSize: "0.6875rem", minWidth: "120px" }}>Validity Period</Typography>
              <Typography sx={{ fontSize: "0.6875rem" }}>{data.documentInfo?.validityPeriod || "Subject to factory final confirmation."}</Typography>
            </Box>
            <Box sx={{ display: "flex", mb: 0.3 }}>
              <Typography sx={{ fontSize: "0.6875rem", minWidth: "120px" }}>Terms Of Payment</Typography>
              <Typography sx={{ fontSize: "0.6875rem" }}>{data.documentInfo?.paymentTerms || "Cash"}</Typography>
            </Box>
            <Box sx={{ display: "flex", mb: 0.3 }}>
              <Typography sx={{ fontSize: "0.6875rem", minWidth: "120px" }}>Delivery Time</Typography>
              <Typography sx={{ fontSize: "0.6875rem" }}>{data.documentInfo?.deliveryTime || "Estimated 6 to 12 weeks upon confirmation of order."}</Typography>
            </Box>
          </Box>

          {/* Closing Message */}
          <Typography sx={{ fontSize: "0.6875rem", mb: 2 }}>
            Hope the above Quotation meets your requirement. Pls contact us if you have any doubt.
          </Typography>

          {/* Computer Generated Notice */}
          <Typography sx={{ fontSize: "0.6875rem", fontStyle: "italic", mb: 3 }}>
            This is a computer generated Quotation. No signature is required.
          </Typography>

          {/* Signature Area */}
          <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
            <Box sx={{ textAlign: "center" }}>
              <Box sx={{ borderTop: "1px solid #000", width: "200px", pt: 0.5 }}>
                <Typography sx={{ fontSize: "0.6875rem" }}>
                  Please Stamp & Sign for Confirmation
                </Typography>
              </Box>
            </Box>
          </Box>
        </Box>

      </Paper>
    );
  }

  // Default layout for other document types
  return (
    <Paper
      sx={{
        width: "210mm",
        minHeight: "297mm",
        margin: "0 auto",
        p: "15mm",
        backgroundColor: "white",
        fontFamily: "var(--font-carlito), 'Calibri', 'Arial', sans-serif",
        fontSize: "0.75rem",
        lineHeight: 1.4,
        color: "#000",
        "@media print": {
          margin: 0,
          padding: "15mm",
          boxShadow: "none",
        },
      }}
    >
      {/* Header with three columns */}
      <Box sx={{ display: "flex", mb: 4 }}>
        {/* Left Column - Logo, Title and Customer */}
        <Box sx={{ width: "35%" }}>
          {(data.logo || organization?.logo) && (
            <Box sx={{ mb: 2, mt: -6, maxWidth: 280, height: 120 }}>
              <img src={getResourceUrl(data.logo || organization?.logo)} alt="Company Logo" style={{ maxWidth: "100%", maxHeight: "100%" }} />
            </Box>
          )}

          <Typography
            sx={{
              fontSize: "1.25rem",
              fontWeight: 600,
              mb: 2
            }}
          >
            {getDocumentTitle()}
          </Typography>

          {/* Customer Info */}
          <Box>
            <Typography sx={{ fontSize: "0.8125rem", fontWeight: 600, mb: 0.5 }}>
              {data.customer?.name || data.customerName || ""}
            </Typography>
            <Typography sx={{ fontSize: "0.6875rem", mb: 0.3, whiteSpace: "pre-line" }}>
              {data.customer?.address || data.customerAddress || ""}
            </Typography>
            {(data.deliveryAddress?.attention || data.attention?.name) && (
              <Typography sx={{ fontSize: "0.6875rem", mb: 0.3 }}>
                Attn: {data.deliveryAddress?.attention || data.attention?.name}
              </Typography>
            )}
            {(data.deliveryAddress?.phone || data.attention?.phoneNumber) && (
              <Typography sx={{ fontSize: "0.6875rem", mb: 0.3 }}>
                Tel: {data.deliveryAddress?.phone || data.attention?.phoneNumber}
              </Typography>
            )}
          </Box>
        </Box>

        {/* Spacer */}
        <Box sx={{ width: "15%" }} />

        {/* Center Column - Document Details */}
        <Box sx={{ width: "20%" }}>
          <Box sx={{ mb: 1.5 }}>
            <Typography sx={{ fontSize: "0.625rem", color: "#666", mb: 0.3 }}>
              {getDocumentTitle()} Date
            </Typography>
            <Typography sx={{ fontSize: "0.75rem", fontWeight: 500 }}>
              {formatDate(data.documentInfo?.date)}
            </Typography>
          </Box>

          <Box sx={{ mb: 1.5 }}>
            <Typography sx={{ fontSize: "0.625rem", color: "#666", mb: 0.3 }}>
              {getDocumentTitle()} Number
            </Typography>
            <Typography sx={{ fontSize: "0.75rem", fontWeight: 500 }}>
              {data.documentInfo?.documentNumber || ""}
            </Typography>
          </Box>

          {data.documentInfo?.referenceNo && (
            <Box sx={{ mb: 1.5 }}>
              <Typography sx={{ fontSize: "0.625rem", color: "#666", mb: 0.3 }}>
                Reference
              </Typography>
              <Typography sx={{ fontSize: "0.75rem", fontWeight: 500 }}>
                {data.documentInfo.referenceNo}
              </Typography>
            </Box>
          )}

          {data.documentInfo?.poNo && (
            <Box sx={{ mb: 1.5 }}>
              <Typography sx={{ fontSize: "0.625rem", color: "#666", mb: 0.3 }}>
                P.O. Number
              </Typography>
              <Typography sx={{ fontSize: "0.75rem", fontWeight: 500 }}>
                {data.documentInfo.poNo}
              </Typography>
            </Box>
          )}

          {data.documentInfo?.doNo && documentType === "RDO" && (
            <Box sx={{ mb: 1.5 }}>
              <Typography sx={{ fontSize: "0.625rem", color: "#666", mb: 0.3 }}>
                D.O. Number
              </Typography>
              <Typography sx={{ fontSize: "0.75rem", fontWeight: 500 }}>
                {data.documentInfo.doNo}
              </Typography>
            </Box>
          )}

          {data.documentInfo?.returnOrderNo && documentType === "RDO" && (
            <Box sx={{ mb: 1.5 }}>
              <Typography sx={{ fontSize: "0.625rem", color: "#666", mb: 0.3 }}>
                Return Order Number
              </Typography>
              <Typography sx={{ fontSize: "0.75rem", fontWeight: 500 }}>
                {data.documentInfo.returnOrderNo}
              </Typography>
            </Box>
          )}
        </Box>

        {/* Right Column - Company Details */}
        <Box sx={{ textAlign: "left", width: "30%" }}>
          <Typography sx={{ fontSize: "0.8125rem", fontWeight: 600, mb: 0.5 }}>
            {data.company?.name || organization?.name || ""}
          </Typography>
          <Typography sx={{ fontSize: "0.6875rem", mb: 0.3, whiteSpace: "pre-line" }}>
            {data.company?.address || organization?.address || ""}
          </Typography>
          {(data.company?.phoneNumber || organization?.phoneNumber) && (
            <Typography sx={{ fontSize: "0.6875rem", mb: 0.3 }}>
              Tel: {data.company?.phoneNumber || organization?.phoneNumber || ""}
            </Typography>
          )}
          {(data.company?.gstRegNo || organization?.registrationNumber) && (
            <>
              <Typography sx={{ fontSize: "0.6875rem", mb: 0.3 }}>
                Company & GST Reg No:
              </Typography>
              <Typography sx={{ fontSize: "0.6875rem", fontWeight: 500 }}>
                {data.company?.gstRegNo || organization?.registrationNumber || ""}
              </Typography>
            </>
          )}
        </Box>
      </Box>

      {/* Delivery Address if different and specified for DO/RDO */}
      {(documentType === "DO" || documentType === "RDO") && data.deliveryAddress?.address && (
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, mb: 0.5 }}>
            Delivery To:
          </Typography>
          <Typography sx={{ fontSize: "0.75rem" }}>
            {data.deliveryAddress.address}
          </Typography>
        </Box>
      )}

      {/* Collect From for RDO */}
      {documentType === "RDO" && data.collectFrom && (
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, mb: 0.5 }}>
            Collect From:
          </Typography>
          <Typography sx={{ fontSize: "0.75rem" }}>
            {data.collectFrom}
          </Typography>
        </Box>
      )}

      {/* Items Table */}
      <TableContainer sx={{ mb: 3 }}>
        <Table
          sx={{
            "& .MuiTableCell-root": {
              border: "none",
              borderBottom: "none",
              padding: "8px",
              fontSize: "0.6875rem",
            },
            "& .MuiTableHead-root .MuiTableCell-root": {
              borderBottom: "2px solid #000",
              fontWeight: "bold",
              backgroundColor: "transparent",
            },
            borderCollapse: "collapse",
          }}
        >
          <TableHead>
            <TableRow>
              <TableCell width="5%">No.</TableCell>
              <TableCell width="50%">Description</TableCell>
              <TableCell width="10%" align="center">
                Qty
              </TableCell>
              <TableCell width="15%" align="right">
                Unit Price
              </TableCell>
              <TableCell width="20%" align="right">
                Amount
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item: any, index: number) => (
              <TableRow key={index}>
                <TableCell>{index + 1}</TableCell>
                <TableCell>{item.description}</TableCell>
                <TableCell align="center">{item.quantity}</TableCell>
                <TableCell align="right">{item.unitPrice?.toFixed(2)}</TableCell>
                <TableCell align="right">{(item.amount || 0).toFixed(2)}</TableCell>
              </TableRow>
            ))}

            {/* Add empty rows to fill space if needed */}
            {items.length < 10 &&
              Array.from({ length: 10 - items.length }).map((_, index) => (
                <TableRow key={`empty-${index}`} sx={{ height: 30 }}>
                  <TableCell>&nbsp;</TableCell>
                  <TableCell>&nbsp;</TableCell>
                  <TableCell>&nbsp;</TableCell>
                  <TableCell>&nbsp;</TableCell>
                  <TableCell>&nbsp;</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Totals */}
      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 3 }}>
        <Box sx={{ width: 250 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
            <Typography variant="body2" sx={{ fontSize: "0.6875rem" }}>
              Subtotal:
            </Typography>
            <Typography variant="body2" sx={{ fontSize: "0.6875rem" }}>
              {subtotal.toFixed(2)}
            </Typography>
          </Box>

          <Box sx={{ display: "flex", justifyContent: "space-between", pt: 1, borderTop: "1px solid #000" }}>
            <Typography variant="body1" sx={{ fontSize: "0.75rem", fontWeight: "bold" }}>
              TOTAL {data.company?.currency || "SGD"}:
            </Typography>
            <Typography variant="body1" sx={{ fontSize: "0.75rem", fontWeight: "bold" }}>
              {subtotal.toFixed(2)}
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Footer Notes */}
      {data.note && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ fontSize: "0.625rem", fontStyle: "italic" }}>
            Notes: {data.note}
          </Typography>
        </Box>
      )}

      {/* Terms & Conditions */}
      {data.termsAndConditions && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ fontSize: "0.625rem", fontWeight: 600, mb: 0.5 }}>
            Terms & Conditions:
          </Typography>
          <Typography variant="body2" sx={{ fontSize: "0.625rem", whiteSpace: "pre-wrap" }}>
            {data.termsAndConditions}
          </Typography>
        </Box>
      )}

      {/* Computer Generated Notice */}
      <Box sx={{ position: "absolute", bottom: "15mm", left: "15mm", right: "15mm", textAlign: "center" }}>
        <Typography variant="body2" sx={{ fontSize: "0.5625rem", fontStyle: "italic", color: "#666" }}>
          This is a computer-generated document. No signature is required.
        </Typography>
      </Box>
    </Paper>
  );
}