/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { format } from "date-fns";
import { enUS } from "date-fns/locale";
import "react-date-range/dist/styles.css"; // main style file
import "react-date-range/dist/theme/default.css"; // theme css file
import { Box, Button, Dialog, IconButton, InputLabel, Stack, Typography, useTheme } from "@mui/material";
import { IconCalendarStats, IconX } from "@tabler/icons-react";
import { dateContainerStyles, StyledDateRangePicker } from "./styles/date-range-picker-styles";

interface Props {
  onConfirm?: (value: any) => void;
  value: { startDate: Date | null; endDate: Date | null };
  label: string;
}

export default function DateRangePicker(props: Props) {
  const { onConfirm = (value: any) => {}, value, label } = props;
  const theme = useTheme();

  const [state, setState] = React.useState([
    {
      startDate: value.startDate ?? undefined, // Use undefined if null
      endDate: value.endDate ?? undefined, // Use undefined if null
      key: "selection",
    },
  ]);
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleDateChange = (item: any) => {
    if (item.selection) {
      const { startDate, endDate } = item.selection;
      setState([
        {
          startDate: startDate ?? undefined, // Use undefined if null
          endDate: endDate ?? undefined, // Use undefined if null
          key: "selection",
        },
      ]);
    }
  };

  const handleClosePopover = () => {
    setState([
      {
        startDate: value.startDate ?? state[0].startDate ?? undefined,
        endDate: value.endDate ?? state[0].endDate ?? undefined,
        key: "selection",
      },
    ]);
    setAnchorEl(null);
  };

  const _onConfirm = () => {
    onConfirm(state[0]);
    setAnchorEl(null);
  };

  const onReset = () => {
    const resetState = { startDate: undefined, endDate: undefined, key: "selection" };
    setState([resetState]);
    onConfirm(resetState);
    setAnchorEl(null);
  };

  return (
    <>
      <Box sx={{ width: "100%" }}>
        <InputLabel
          sx={{
            color: "text.secondary",
            display: "flex",
            alignItems: "space-between",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          {label}
          <Button sx={{ p: 0 }} onClick={onReset}>
            Reset filter
          </Button>
        </InputLabel>

        <Stack
          direction="row"
          spacing={2}
          sx={{
            width: "100%",
          }}
        >
          <Box display="flex" flexDirection="column" alignItems="flex-start" width="100%" p={0}>
            <Typography sx={{ width: "100%" }}>From:</Typography>
            <Box onClick={handleClick} sx={dateContainerStyles(theme, !state[0].startDate)} role="button">
              <Typography>{!state[0].startDate ? "Select the start date" : format(state[0].startDate, "dd/MM/yyyy")}</Typography>

              <IconButton size="small">
                <IconCalendarStats />
              </IconButton>
            </Box>
          </Box>
          <Box display="flex" flexDirection="column" alignItems="flex-start" width="100%" p={0}>
            <Typography>To:</Typography>
            <Box onClick={handleClick} sx={dateContainerStyles(theme, !state[0].endDate)} role="button">
              {!state[0].endDate ? "select the end date" : format(state[0].endDate, "dd/MM/yyyy")}
              <IconButton onClick={handleClick} size="small">
                <IconCalendarStats />
              </IconButton>
            </Box>
          </Box>
        </Stack>
      </Box>

      <Dialog open={Boolean(anchorEl)} onClose={handleClosePopover} sx={{ "& .MuiDialog-paper": { background: theme.palette.tertiary.contrastText } }}>
        <Box className="--DATERANGEPICKER">
          <Box className="--DATERANGEPICKER-HEADER" sx={{ mb: 1 }}>
            <Typography variant="h4">Select a date range</Typography>

            <IconButton size="small" onClick={handleClosePopover}>
              <IconX />
            </IconButton>
          </Box>

          <StyledDateRangePicker onChange={handleDateChange} moveRangeOnFirstSelection={false} months={1} ranges={state} direction="horizontal" locale={enUS} />

          <Box display="flex" justifyContent="space-between" alignItems="center" sx={{ mt: 2, px: 2, pb: 2 }}>
            <Button onClick={handleClosePopover} color="info" variant="outlined">
              Close
            </Button>
            <Button onClick={_onConfirm} color="primary" variant="contained" sx={{ minWidth: "100px" }}>
              Apply
            </Button>
          </Box>
        </Box>
      </Dialog>
    </>
  );
}
