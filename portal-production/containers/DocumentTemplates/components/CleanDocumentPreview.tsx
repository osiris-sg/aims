"use client";

import React from "react";
import { Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from "@mui/material";

interface CleanDocumentPreviewProps {
  documentType: "QO1" | "DO" | "RDO" | "TI" | "MSR";
  data: any;
  organization?: any;
}

export default function CleanDocumentPreview({ documentType, data, organization }: CleanDocumentPreviewProps) {
  const getDocumentTitle = () => {
    const titles = {
      QO1: "QUOTATION",
      DO: "DELIVERY ORDER",
      RDO: "RETURN DELIVERY ORDER",
      TI: "Tax Invoice",
      MSR: "MAINTENANCE SERVICE REPORT",
    };
    return titles[documentType] || "DOCUMENT";
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
          fontFamily: "'Arial', sans-serif",
          fontSize: "12px",
          lineHeight: 1.6,
          color: "#000",
          "@media print": {
            margin: 0,
            padding: "20mm",
            boxShadow: "none",
          },
        }}
      >
        {/* Header with Logo and Company Info */}
        <Box sx={{ display: "flex", justifyContent: "space-between", mb: 4 }}>
          {/* Left Side - Logo and Title */}
          <Box sx={{ flex: 1 }}>
            {data.logo && (
              <Box sx={{ mb: 2, maxWidth: 150, height: 60 }}>
                <img src={data.logo} alt="Company Logo" style={{ maxWidth: "100%", maxHeight: "100%" }} />
              </Box>
            )}

            <Typography
              variant="h4"
              sx={{
                fontSize: "24px",
                fontWeight: 500,
                mt: 2,
                mb: 3
              }}
            >
              {getDocumentTitle()}
            </Typography>

            {/* Customer Info */}
            <Box sx={{ mb: 2 }}>
              <Typography sx={{ fontSize: "13px", fontWeight: 600, mb: 0.5 }}>
                {data.customer?.name || ""}
              </Typography>
              <Typography sx={{ fontSize: "12px", mb: 0.3 }}>
                {data.customer?.address && typeof data.customer.address === 'string'
                  ? data.customer.address.split("\n").map((line: string, index: number) => (
                      <React.Fragment key={index}>
                        {line}
                        {index < data.customer.address.split("\n").length - 1 && <br />}
                      </React.Fragment>
                    ))
                  : data.customer?.address || ''}
              </Typography>
              {data.customer?.attention && (
                <Typography sx={{ fontSize: "12px", mb: 0.3 }}>
                  Attn: {data.customer.attention}
                </Typography>
              )}
            </Box>
          </Box>

          {/* Right Side - Invoice Details */}
          <Box sx={{ textAlign: "left", minWidth: 280 }}>
            <Box sx={{ mb: 0.5 }}>
              <Typography sx={{ fontSize: "11px", color: "#666", mb: 0.2 }}>
                Invoice Date
              </Typography>
              <Typography sx={{ fontSize: "12px", fontWeight: 500 }}>
                {formatDate(data.documentInfo?.date)}
              </Typography>
            </Box>

            <Box sx={{ mb: 0.5 }}>
              <Typography sx={{ fontSize: "11px", color: "#666", mb: 0.2 }}>
                Invoice Number
              </Typography>
              <Typography sx={{ fontSize: "12px", fontWeight: 500 }}>
                {data.documentInfo?.documentNumber || ""}
              </Typography>
            </Box>

            {data.documentInfo?.referenceNo && (
              <Box sx={{ mb: 0.5 }}>
                <Typography sx={{ fontSize: "11px", color: "#666", mb: 0.2 }}>
                  Reference
                </Typography>
                <Typography sx={{ fontSize: "12px", fontWeight: 500 }}>
                  {data.documentInfo.referenceNo}
                  {data.documentInfo?.referenceDate && (
                    <span style={{ fontSize: "11px", fontWeight: "normal" }}>
                      {" "}({formatDate(data.documentInfo.referenceDate)})
                    </span>
                  )}
                </Typography>
              </Box>
            )}

            {/* Company Details on the right */}
            <Box sx={{ mt: 2, pt: 2, borderTop: "1px solid #eee" }}>
              <Typography sx={{ fontSize: "13px", fontWeight: 600, mb: 0.5 }}>
                {data.company?.name || organization?.name || ""}
              </Typography>
              <Typography sx={{ fontSize: "11px", mb: 0.2 }}>
                {data.company?.address || ""}
              </Typography>
              <Typography sx={{ fontSize: "11px", mb: 0.2 }}>
                Tel: {data.company?.phoneNumber || ""}
              </Typography>
              <Typography sx={{ fontSize: "11px", mb: 0.2 }}>
                Company & GST Reg No:
              </Typography>
              <Typography sx={{ fontSize: "11px" }}>
                {data.company?.gstRegNo || ""}
              </Typography>
            </Box>
          </Box>
        </Box>

        {/* Items Table */}
        <TableContainer sx={{ mb: 3, mt: 5 }}>
          <Table
            sx={{
              "& .MuiTableCell-root": {
                borderBottom: "1px solid #ddd",
                padding: "10px 8px",
                fontSize: "11px",
              },
              "& .MuiTableHead-root .MuiTableCell-root": {
                borderTop: "1px solid #000",
                borderBottom: "2px solid #000",
                fontWeight: 600,
                fontSize: "11px",
              },
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: "50%" }}>Description</TableCell>
                <TableCell sx={{ width: "12%", textAlign: "center" }}>Quantity</TableCell>
                <TableCell sx={{ width: "15%", textAlign: "right" }}>Unit Price</TableCell>
                <TableCell sx={{ width: "8%", textAlign: "center" }}>Tax</TableCell>
                <TableCell sx={{ width: "15%", textAlign: "right" }}>Amount SGD</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item: any, index: number) => (
                <TableRow key={index}>
                  <TableCell>
                    <Box>
                      <Typography sx={{ fontSize: "11px", fontWeight: 500, mb: 0.5 }}>
                        {item.description}
                      </Typography>
                      {item.details && (
                        <Box sx={{ pl: 1 }}>
                          {typeof item.details === 'string'
                            ? item.details.split("\n").map((detail: string, idx: number) => (
                                <Typography key={idx} sx={{ fontSize: "10px", color: "#666", lineHeight: 1.4 }}>
                                  {detail}
                                </Typography>
                              ))
                            : <Typography sx={{ fontSize: "10px", color: "#666", lineHeight: 1.4 }}>
                                {item.details}
                              </Typography>}
                        </Box>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell sx={{ textAlign: "center" }}>{item.quantity?.toFixed(2)}</TableCell>
                  <TableCell sx={{ textAlign: "right" }}>{item.unitPrice?.toFixed(2)}</TableCell>
                  <TableCell sx={{ textAlign: "center" }}>{item.tax || 9}%</TableCell>
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
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </TableContainer>

        {/* Additional Information */}
        {(data.documentInfo?.doNo || data.documentInfo?.qinRef || data.documentInfo?.woNo ||
          data.documentInfo?.location || data.documentInfo?.projectDept) && (
          <Box sx={{ mb: 3, fontSize: "11px", lineHeight: 1.8 }}>
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
              <Typography sx={{ fontSize: "12px", textAlign: "right", width: "60%" }}>
                Subtotal
              </Typography>
              <Typography sx={{ fontSize: "12px", textAlign: "right", width: "40%" }}>
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
              <Typography sx={{ fontSize: "11px", textAlign: "right", width: "60%" }}>
                TOTAL LOCAL SUPPLY OF GOODS<br />AND SERVICES 9%
              </Typography>
              <Typography sx={{ fontSize: "12px", textAlign: "right", width: "40%", alignSelf: "flex-end" }}>
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
              <Typography sx={{ fontSize: "12px", fontWeight: 600, textAlign: "right", width: "60%" }}>
                TOTAL SGD
              </Typography>
              <Typography sx={{ fontSize: "12px", fontWeight: 600, textAlign: "right", width: "40%" }}>
                {total.toFixed(2)}
              </Typography>
            </Box>
          </Box>
        </Box>

        {/* Due Date and Payment Info */}
        <Box sx={{ mt: 6, fontSize: "11px", lineHeight: 1.8 }}>
          <Typography sx={{ fontWeight: 600, mb: 1 }}>
            Due Date: {formatDate(data.dueDate) || "30 Nov 2024"}
          </Typography>
          <Typography sx={{ mb: 0.3 }}>
            All Cheque should be crossed and made payable to: {data.company?.name || organization?.name || ""}
          </Typography>
          <Typography sx={{ mb: 0.3 }}>
            By Bank Transfer: {data.bankDetails?.bankName || "Standard Chartered Bank"}
          </Typography>
          <Typography sx={{ mb: 0.3 }}>
            Branch: {data.bankDetails?.branch || "12 Marina Boulevard, Marina Bay Financial Centre Tower 1"}
          </Typography>
          <Typography sx={{ mb: 0.3 }}>
            Bank Branch No.: {data.bankDetails?.branchNo || "9496-007"} Swift Code: {data.bankDetails?.swiftCode || "SCBLSG22"}
          </Typography>
          <Typography sx={{ mb: 0.3 }}>
            Bank Account No.: {data.bankDetails?.accountNo || "07-1-005302-9"}
          </Typography>
          <Typography sx={{ mb: 0.3 }}>
            PayNow to UEN: {data.company?.gstRegNo || "200303416N"}
          </Typography>
        </Box>

        {/* Footer */}
        <Box sx={{ mt: 4, pt: 2, textAlign: "center" }}>
          <Typography sx={{ fontSize: "10px", fontStyle: "italic", color: "#666" }}>
            This is a computer-generated document, no signature is required
          </Typography>
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
        fontFamily: "'Arial', sans-serif",
        fontSize: "12px",
        lineHeight: 1.4,
        color: "#000",
        "@media print": {
          margin: 0,
          padding: "15mm",
          boxShadow: "none",
        },
      }}
    >
      {/* Header Section */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          mb: 4,
        }}
      >
        {/* Company Logo/Info Left */}
        <Box sx={{ flex: 1 }}>
          {data.logo && (
            <Box sx={{ mb: 2, maxWidth: 180, height: 80 }}>
              <img src={data.logo} alt="Company Logo" style={{ maxWidth: "100%", maxHeight: "100%" }} />
            </Box>
          )}
        </Box>

        {/* Company Details Right */}
        <Box sx={{ textAlign: "right" }}>
          <Typography variant="h6" sx={{ fontWeight: "bold", fontSize: "16px", mb: 0.5 }}>
            {data.company?.name || organization?.name || ""}
          </Typography>
          <Typography variant="body2" sx={{ fontSize: "11px", mb: 0.3 }}>
            {data.company?.address || ""}
          </Typography>
          {data.company?.phoneNumber && (
            <Typography variant="body2" sx={{ fontSize: "11px", mb: 0.3 }}>
              Tel: {data.company.phoneNumber}
            </Typography>
          )}
          {data.company?.gstRegNo && (
            <Typography variant="body2" sx={{ fontSize: "11px" }}>
              GST Reg No: {data.company.gstRegNo}
            </Typography>
          )}
        </Box>
      </Box>

      {/* Document Title */}
      <Box sx={{ textAlign: "center", mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: "bold", fontSize: "20px" }}>
          {getDocumentTitle()}
        </Typography>
      </Box>

      {/* Two Column Layout for Customer and Document Info */}
      <Box sx={{ display: "flex", gap: 4, mb: 3 }}>
        {/* Left Column - Customer Info */}
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: "bold", mb: 1, fontSize: "12px" }}>
            Bill To:
          </Typography>
          <Box sx={{ pl: 1 }}>
            <Typography variant="body1" sx={{ fontWeight: 600, fontSize: "12px", mb: 0.5 }}>
              {data.customer?.name || ""}
            </Typography>
            <Typography variant="body2" sx={{ fontSize: "11px", mb: 0.5 }}>
              {data.customer?.address || ""}
            </Typography>
            {data.deliveryAddress?.attention && (
              <Typography variant="body2" sx={{ fontSize: "11px", mb: 0.3 }}>
                Attn: {data.deliveryAddress.attention}
              </Typography>
            )}
            {data.deliveryAddress?.phone && (
              <Typography variant="body2" sx={{ fontSize: "11px" }}>
                Tel: {data.deliveryAddress.phone}
              </Typography>
            )}
          </Box>

          {/* Delivery Address if different */}
          {data.deliveryAddress?.address && (
            <>
              <Typography variant="subtitle2" sx={{ fontWeight: "bold", mt: 2, mb: 1, fontSize: "12px" }}>
                Ship To:
              </Typography>
              <Box sx={{ pl: 1 }}>
                <Typography variant="body2" sx={{ fontSize: "11px" }}>
                  {data.deliveryAddress.address}
                </Typography>
              </Box>
            </>
          )}
        </Box>

        {/* Right Column - Document Details */}
        <Box sx={{ minWidth: 250 }}>
          <Box sx={{ display: "flex", mb: 0.8 }}>
            <Typography variant="body2" sx={{ fontSize: "11px", fontWeight: 600, width: 120 }}>
              {getDocumentTitle()} NO:
            </Typography>
            <Typography variant="body2" sx={{ fontSize: "11px" }}>
              {data.documentInfo?.documentNumber || ""}
            </Typography>
          </Box>

          <Box sx={{ display: "flex", mb: 0.8 }}>
            <Typography variant="body2" sx={{ fontSize: "11px", fontWeight: 600, width: 120 }}>
              DATE:
            </Typography>
            <Typography variant="body2" sx={{ fontSize: "11px" }}>
              {data.documentInfo?.date ? new Date(data.documentInfo.date).toLocaleDateString("en-GB") : ""}
            </Typography>
          </Box>

          {data.documentInfo?.referenceNo && (
            <Box sx={{ display: "flex", mb: 0.8 }}>
              <Typography variant="body2" sx={{ fontSize: "11px", fontWeight: 600, width: 120 }}>
                REF NO:
              </Typography>
              <Typography variant="body2" sx={{ fontSize: "11px" }}>
                {data.documentInfo.referenceNo}
              </Typography>
            </Box>
          )}

          {data.documentInfo?.poNo && (
            <Box sx={{ display: "flex", mb: 0.8 }}>
              <Typography variant="body2" sx={{ fontSize: "11px", fontWeight: 600, width: 120 }}>
                P.O. NO:
              </Typography>
              <Typography variant="body2" sx={{ fontSize: "11px" }}>
                {data.documentInfo.poNo}
              </Typography>
            </Box>
          )}

          {data.paymentTerms && (
            <Box sx={{ display: "flex", mb: 0.8 }}>
              <Typography variant="body2" sx={{ fontSize: "11px", fontWeight: 600, width: 120 }}>
                TERMS:
              </Typography>
              <Typography variant="body2" sx={{ fontSize: "11px" }}>
                {data.paymentTerms}
              </Typography>
            </Box>
          )}

          {data.dueDate && (
            <Box sx={{ display: "flex", mb: 0.8 }}>
              <Typography variant="body2" sx={{ fontSize: "11px", fontWeight: 600, width: 120 }}>
                DUE DATE:
              </Typography>
              <Typography variant="body2" sx={{ fontSize: "11px" }}>
                {new Date(data.dueDate).toLocaleDateString("en-GB")}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      {/* Items Table */}
      <TableContainer sx={{ mb: 3 }}>
        <Table
          sx={{
            "& .MuiTableCell-root": {
              border: "1px solid #000",
              padding: "6px 8px",
              fontSize: "11px",
            },
            "& .MuiTableHead-root .MuiTableCell-root": {
              backgroundColor: "#f0f0f0",
              fontWeight: "bold",
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
            <Typography variant="body2" sx={{ fontSize: "11px" }}>
              Subtotal:
            </Typography>
            <Typography variant="body2" sx={{ fontSize: "11px" }}>
              {subtotal.toFixed(2)}
            </Typography>
          </Box>

          <Box sx={{ display: "flex", justifyContent: "space-between", pt: 1, borderTop: "1px solid #000" }}>
            <Typography variant="body1" sx={{ fontSize: "12px", fontWeight: "bold" }}>
              TOTAL {data.company?.currency || "SGD"}:
            </Typography>
            <Typography variant="body1" sx={{ fontSize: "12px", fontWeight: "bold" }}>
              {subtotal.toFixed(2)}
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Footer Notes */}
      {data.note && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ fontSize: "10px", fontStyle: "italic" }}>
            Notes: {data.note}
          </Typography>
        </Box>
      )}

      {/* Terms & Conditions */}
      {data.termsAndConditions && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ fontSize: "10px", fontWeight: 600, mb: 0.5 }}>
            Terms & Conditions:
          </Typography>
          <Typography variant="body2" sx={{ fontSize: "10px", whiteSpace: "pre-wrap" }}>
            {data.termsAndConditions}
          </Typography>
        </Box>
      )}

      {/* Computer Generated Notice */}
      <Box sx={{ position: "absolute", bottom: "15mm", left: "15mm", right: "15mm", textAlign: "center" }}>
        <Typography variant="body2" sx={{ fontSize: "9px", fontStyle: "italic", color: "#666" }}>
          This is a computer-generated document. No signature is required.
        </Typography>
      </Box>
    </Paper>
  );
}