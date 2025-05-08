import { Paper, Skeleton } from "@mui/material";
import React from "react";

export default function DocumentSkeleton() {
  return (
    <Paper elevation={0} sx={{ padding: 4, width: "894px", minHeight: "1123px", margin: "auto", backgroundColor: "white" }}>
      <Skeleton variant="text" height={40} width="60%" animation="wave" />
      <Skeleton variant="text" height={30} width="40%" sx={{ mt: 2 }} animation="wave" />
      <Skeleton variant="rectangular" height={200} sx={{ mt: 3 }} animation="wave" />
      <Skeleton variant="rectangular" height={400} sx={{ mt: 3 }} animation="wave" />
    </Paper>
  );
}
