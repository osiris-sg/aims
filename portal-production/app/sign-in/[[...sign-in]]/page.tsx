import { SignIn } from "@clerk/nextjs";
import { Box, Link, Typography } from "@mui/material";
import { PRIVACY_POLICY_URL } from "@/lib/legal";

export default function Page() {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        width: "100%",
        height: "100%",
        gap: 2,
      }}
    >
      <SignIn fallbackRedirectUrl="/portal" signUpFallbackRedirectUrl="/portal" />
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        <Link href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer" color="inherit" underline="hover">
          Privacy policy
        </Link>
      </Typography>
    </Box>
  );
}
