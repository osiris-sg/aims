"use client";
import { Box } from "@mui/material";

export default function Page() {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        width: "100vw",
        minHeight: "100vh",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <Box
        sx={{
          position: "relative",
          width: "60px",
          height: "60px",
        }}
      >
        {[...Array(3)].map((_, index) => (
          <Box
            key={index}
            sx={{
              position: "absolute",
              width: "100%",
              height: "100%",
              border: "2px solid",
              borderColor: "primary.main",
              borderRadius: 1,
              animation: "stack 1.5s ease infinite",
              animationDelay: `${index * 0.3}s`,
              "@keyframes stack": {
                "0%": {
                  top: 0,
                  opacity: 0,
                },
                "20%": {
                  top: 0,
                  opacity: 1,
                },
                "100%": {
                  top: "20px",
                  opacity: 0,
                },
              },
            }}
          />
        ))}
      </Box>
    </Box>
  );
}
