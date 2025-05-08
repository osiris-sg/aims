import React from "react";
import { Box, Step, StepConnector, StepIconProps, StepLabel, Stepper, styled, useTheme } from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";

const CustomStepIcon = (props: StepIconProps) => {
  const theme = useTheme();
  const { active, completed } = props;

  return (
    <Box
      sx={{
        width: 24,
        height: 24,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        border: completed ? "none" : `2px solid ${active ? theme.palette.secondary.main : theme.palette.secondary.light}`,
        backgroundColor: completed ? theme.palette.secondary.main : "transparent",
        color: completed ? "white" : active ? theme.palette.secondary.main : theme.palette.secondary.light,
      }}
    >
      {completed ? <CheckIcon sx={{ fontSize: 18 }} /> : active ? "•" : ""}
    </Box>
  );
};

const CustomConnector = styled(StepConnector)(({ theme }) => ({
  [`&.MuiStepConnector-root`]: {
    top: 12,
  },
  [`& .MuiStepConnector-line`]: {
    borderColor: theme.palette.secondary.light,
    borderTopWidth: 2,
  },
  [`&.Mui-active .MuiStepConnector-line`]: {
    borderColor: theme.palette.secondary.main,
  },
  [`&.Mui-completed .MuiStepConnector-line`]: {
    borderColor: theme.palette.secondary.main,
  },
}));

interface CustomStepperProps {
  activeStep: number;
  steps: string[];
}

const CustomStepper: React.FC<CustomStepperProps> = ({ activeStep, steps }) => {
  return (
    <Stepper activeStep={activeStep} alternativeLabel connector={<CustomConnector />}>
      {steps.map((label, index) => (
        <Step key={index}>
          <StepLabel StepIconComponent={CustomStepIcon}>{label}</StepLabel>
        </Step>
      ))}
    </Stepper>
  );
};

export default CustomStepper;
