import { styled, Theme } from "@mui/material";
import { DateRangePicker as ImportedRangePicker } from "react-date-range";
export const StyledDateRangePicker = styled(ImportedRangePicker)(({ theme }) => ({
  "& .rdrDateDisplayItemActive": {
    border: `1px solid ${theme.palette.primary.main}`,
    fontFamily: theme.typography.fontFamily,
  },
  "& .rdrDateDisplayWrapper": {
    backgroundColor: theme.palette.primary.contrastText,
  },
  "& .rdrDayNumber": {
    color: theme.palette.text.primary,
  },
  "& .rdrDayNumberSelected": {
    backgroundColor: theme.palette.primary.main,
    color: "#fff",
  },
  "& .rdrDayNumberHovered": {
    backgroundColor: theme.palette.primary.light,
  },
  "& .rdrSelectedRange": {
    backgroundColor: theme.palette.primary.main,
    color: "#fff",
  },
  "& .rdrMonthAndYearPickers select": {
    fontFamily: theme.typography.fontFamily,
  },
  "& .rdrCalendarWrapper": {
    backgroundColor: theme.palette.primary.contrastText,
    color: theme.palette.text.primary,
  },
  "& .rdrPrevButton, .rdrNextButton": {
    color: theme.palette.primary.main,
  },
  "& .rdrMonths": {
    fontFamily: theme.typography.fontFamily,
  },
  "& .rdrInRange, .rdrEndEdge, .rdrStartEdge": {
    backgroundColor: theme.palette.primary.main,
  },

  // Side menu styling
  "& .rdrDefinedRangesWrapper": {
    backgroundColor: theme.palette.primary.contrastText,
    borderRadius: "8px 0 0 8px",
    width: "160px",
    fontFamily: theme.typography.fontFamily,
  },
  "& .rdrStaticRange": {
    //   borderBottom: `1px solid ${theme.palette.divider}`,
    fontSize: "14px",
    color: theme.palette.text.primary,
  },
  "& .rdrStaticRange:hover, .rdrStaticRange:focus": {
    backgroundColor: theme.palette.action.hover,
    color: theme.palette.primary.main,
  },
  "& .rdrStaticRangeSelected": {
    backgroundColor: theme.palette.action.selected,
    color: theme.palette.primary.main,
    fontWeight: 600,
  },
  "& .rdrInputRanges": {
    backgroundColor: theme.palette.primary.contrastText,
  },
  "& .rdrInputRange input": {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: "4px",
    color: theme.palette.text.primary,
  },
  "& .rdrInputRange input:focus": {
    borderColor: theme.palette.primary.main,
    outline: "none",
  },

  // Day styling
  "& .rdrDay:not(.rdrDayPassive) .rdrInRange ~ .rdrDayNumber span, & .rdrDay:not(.rdrDayPassive) .rdrStartEdge ~ .rdrDayNumber span, & .rdrDay:not(.rdrDayPassive) .rdrEndEdge ~ .rdrDayNumber span, & .rdrDay:not(.rdrDayPassive) .rdrSelected ~ .rdrDayNumber span": {
    color: theme.palette.primary.contrastText,
  },

  // Today styling
  "& .rdrDayToday .rdrDayNumber span:after": {
    backgroundColor: theme.palette.primary.main,
  },
}));

export const dateContainerStyles = (theme: Theme, hasValue: boolean) => ({
  border: `1px solid ${theme.palette.divider}`,
  color: hasValue ? theme.palette.text.secondary : theme.palette.text.primary,
  "&:hover": {
    borderColor: theme.palette.action.hover,
  },

  borderRadius: "16px",
  width: "100%",
  pl: 1.5,
  py: 0.5,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  cursor: "pointer",
});
