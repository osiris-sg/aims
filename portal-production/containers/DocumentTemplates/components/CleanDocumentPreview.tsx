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
        {/* Header with three columns */}
        <Box sx={{ display: "flex", mb: 4 }}>
          {/* Left Column - Logo, Title and Customer */}
          <Box sx={{ width: "35%" }}>
            {(data.logo || organization?.logo) && (
              <Box sx={{ mb: 2, maxWidth: 120, height: 50 }}>
                <img src={data.logo || organization?.logo} alt="Company Logo" style={{ maxWidth: "100%", maxHeight: "100%" }} />
              </Box>
            )}

            <Typography
              sx={{
                fontSize: "20px",
                fontWeight: 600,
                mb: 2
              }}
            >
              Tax Invoice
            </Typography>

            {/* Customer Info */}
            <Box>
              <Typography sx={{ fontSize: "13px", fontWeight: 600, mb: 0.5 }}>
                {data.customer?.name || ""}
              </Typography>
              <Typography sx={{ fontSize: "11px", mb: 0.3, whiteSpace: "pre-line" }}>
                {data.customer?.address || ""}
              </Typography>
              {data.deliveryAddress?.attention && (
                <Typography sx={{ fontSize: "11px", mb: 0.3 }}>
                  Attn: {data.deliveryAddress.attention}
                </Typography>
              )}
            </Box>
          </Box>

          {/* Spacer */}
          <Box sx={{ width: "15%" }} />

          {/* Center Column - Invoice Details */}
          <Box sx={{ width: "20%" }}>
            <Box sx={{ mb: 1.5 }}>
              <Typography sx={{ fontSize: "10px", color: "#666", mb: 0.3 }}>
                Invoice Date
              </Typography>
              <Typography sx={{ fontSize: "12px", fontWeight: 500 }}>
                {formatDate(data.documentInfo?.date)}
              </Typography>
            </Box>

            <Box sx={{ mb: 1.5 }}>
              <Typography sx={{ fontSize: "10px", color: "#666", mb: 0.3 }}>
                Invoice Number
              </Typography>
              <Typography sx={{ fontSize: "12px", fontWeight: 500 }}>
                {data.documentInfo?.documentNumber || ""}
              </Typography>
            </Box>

            <Box sx={{ mb: 1.5 }}>
              <Typography sx={{ fontSize: "10px", color: "#666", mb: 0.3 }}>
                Reference
              </Typography>
              <Typography sx={{ fontSize: "12px", fontWeight: 500, whiteSpace: "pre-line" }}>
                {data.documentInfo?.referenceNo || ""}
                {data.documentInfo?.doNo && (
                  <>{'\n'}({data.documentInfo.doNo})</>
                )}
              </Typography>
            </Box>
          </Box>

          {/* Right Column - Company Details */}
          <Box sx={{ textAlign: "left", width: "30%" }}>
            <Typography sx={{ fontSize: "13px", fontWeight: 600, mb: 0.5 }}>
              {data.company?.name || organization?.name || ""}
            </Typography>
            <Typography sx={{ fontSize: "11px", mb: 0.3, whiteSpace: "pre-line" }}>
              {data.company?.address || organization?.address || ""}
            </Typography>
            <Typography sx={{ fontSize: "11px", mb: 0.3 }}>
              Tel: {data.company?.phoneNumber || organization?.phoneNumber || ""}
            </Typography>
            <Typography sx={{ fontSize: "11px", mb: 0.3 }}>
              Company & GST Reg No:
            </Typography>
            <Typography sx={{ fontSize: "11px", fontWeight: 500 }}>
              {data.company?.gstRegNo || organization?.registrationNumber || ""}
            </Typography>
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
      {/* Header with three columns */}
      <Box sx={{ display: "flex", mb: 4 }}>
        {/* Left Column - Logo, Title and Customer */}
        <Box sx={{ width: "35%" }}>
          {(data.logo || organization?.logo) && (
            <Box sx={{ mb: 2, maxWidth: 120, height: 50 }}>
              <img src={data.logo || organization?.logo} alt="Company Logo" style={{ maxWidth: "100%", maxHeight: "100%" }} />
            </Box>
          )}

          <Typography
            sx={{
              fontSize: "20px",
              fontWeight: 600,
              mb: 2
            }}
          >
            {getDocumentTitle()}
          </Typography>

          {/* Customer Info */}
          <Box>
            <Typography sx={{ fontSize: "13px", fontWeight: 600, mb: 0.5 }}>
              {data.customer?.name || ""}
            </Typography>
            <Typography sx={{ fontSize: "11px", mb: 0.3, whiteSpace: "pre-line" }}>
              {data.customer?.address || ""}
            </Typography>
            {data.deliveryAddress?.attention && (
              <Typography sx={{ fontSize: "11px", mb: 0.3 }}>
                Attn: {data.deliveryAddress.attention}
              </Typography>
            )}
            {data.deliveryAddress?.phone && (
              <Typography sx={{ fontSize: "11px", mb: 0.3 }}>
                Tel: {data.deliveryAddress.phone}
              </Typography>
            )}
          </Box>
        </Box>

        {/* Spacer */}
        <Box sx={{ width: "15%" }} />

        {/* Center Column - Document Details */}
        <Box sx={{ width: "20%" }}>
          <Box sx={{ mb: 1.5 }}>
            <Typography sx={{ fontSize: "10px", color: "#666", mb: 0.3 }}>
              {getDocumentTitle()} Date
            </Typography>
            <Typography sx={{ fontSize: "12px", fontWeight: 500 }}>
              {formatDate(data.documentInfo?.date)}
            </Typography>
          </Box>

          <Box sx={{ mb: 1.5 }}>
            <Typography sx={{ fontSize: "10px", color: "#666", mb: 0.3 }}>
              {getDocumentTitle()} Number
            </Typography>
            <Typography sx={{ fontSize: "12px", fontWeight: 500 }}>
              {data.documentInfo?.documentNumber || ""}
            </Typography>
          </Box>

          {data.documentInfo?.referenceNo && (
            <Box sx={{ mb: 1.5 }}>
              <Typography sx={{ fontSize: "10px", color: "#666", mb: 0.3 }}>
                Reference
              </Typography>
              <Typography sx={{ fontSize: "12px", fontWeight: 500 }}>
                {data.documentInfo.referenceNo}
              </Typography>
            </Box>
          )}

          {data.documentInfo?.poNo && (
            <Box sx={{ mb: 1.5 }}>
              <Typography sx={{ fontSize: "10px", color: "#666", mb: 0.3 }}>
                P.O. Number
              </Typography>
              <Typography sx={{ fontSize: "12px", fontWeight: 500 }}>
                {data.documentInfo.poNo}
              </Typography>
            </Box>
          )}

          {data.documentInfo?.doNo && documentType === "RDO" && (
            <Box sx={{ mb: 1.5 }}>
              <Typography sx={{ fontSize: "10px", color: "#666", mb: 0.3 }}>
                D.O. Number
              </Typography>
              <Typography sx={{ fontSize: "12px", fontWeight: 500 }}>
                {data.documentInfo.doNo}
              </Typography>
            </Box>
          )}

          {data.documentInfo?.returnOrderNo && documentType === "RDO" && (
            <Box sx={{ mb: 1.5 }}>
              <Typography sx={{ fontSize: "10px", color: "#666", mb: 0.3 }}>
                Return Order Number
              </Typography>
              <Typography sx={{ fontSize: "12px", fontWeight: 500 }}>
                {data.documentInfo.returnOrderNo}
              </Typography>
            </Box>
          )}
        </Box>

        {/* Right Column - Company Details */}
        <Box sx={{ textAlign: "left", width: "30%" }}>
          <Typography sx={{ fontSize: "13px", fontWeight: 600, mb: 0.5 }}>
            {data.company?.name || organization?.name || ""}
          </Typography>
          <Typography sx={{ fontSize: "11px", mb: 0.3, whiteSpace: "pre-line" }}>
            {data.company?.address || organization?.address || ""}
          </Typography>
          {(data.company?.phoneNumber || organization?.phoneNumber) && (
            <Typography sx={{ fontSize: "11px", mb: 0.3 }}>
              Tel: {data.company?.phoneNumber || organization?.phoneNumber || ""}
            </Typography>
          )}
          {(data.company?.gstRegNo || organization?.registrationNumber) && (
            <>
              <Typography sx={{ fontSize: "11px", mb: 0.3 }}>
                Company & GST Reg No:
              </Typography>
              <Typography sx={{ fontSize: "11px", fontWeight: 500 }}>
                {data.company?.gstRegNo || organization?.registrationNumber || ""}
              </Typography>
            </>
          )}
        </Box>
      </Box>

      {/* Delivery Address if different and specified for DO/RDO */}
      {(documentType === "DO" || documentType === "RDO") && data.deliveryAddress?.address && (
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontSize: "12px", fontWeight: 600, mb: 0.5 }}>
            Delivery To:
          </Typography>
          <Typography sx={{ fontSize: "12px" }}>
            {data.deliveryAddress.address}
          </Typography>
        </Box>
      )}

      {/* Collect From for RDO */}
      {documentType === "RDO" && data.collectFrom && (
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontSize: "12px", fontWeight: 600, mb: 0.5 }}>
            Collect From:
          </Typography>
          <Typography sx={{ fontSize: "12px" }}>
            {data.collectFrom}
          </Typography>
        </Box>
      )}

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