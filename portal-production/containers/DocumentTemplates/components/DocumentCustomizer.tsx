/* eslint-disable @typescript-eslint/no-explicit-any */
import { IconButton, List, ListItem, ListItemText, Stack, Typography } from "@mui/material";
import { IconEye, IconEyeOff } from "@tabler/icons-react";
import React from "react";
import { Control, Controller, FieldValues } from "react-hook-form";

interface Props {
  isNoSelectionColumn?: boolean;
  fields: { title: string; items: { label: string; name: string }[] }[];
  control: Control<FieldValues, object> | undefined | any;
}
export default function DocumentCustomizer(props: Props) {
  const { fields, control } = props;

  return (
    <Stack sx={{ gap: "var(--half-gap)" }}>
      {fields.map((fieldItem, index) => (
        <Stack key={`fields=item-${index}`}>
          <Typography variant="body1" sx={{ p: "var(--half-padding)", backgroundColor: "tertiary.main", borderRadius: "var(--default-border-radius)" }}>
            {fieldItem.title}
          </Typography>
          <List dense>
            {fieldItem.items.map((_item, _index) => (
              <ListItem key={_index}>
                <ListItemText primary={_item.label} />
                <Controller control={control} name={_item.name} render={({ field: { onChange, value } }) => <IconWrapper onClick={() => onChange(!value)}>{value === true ? <IconEye /> : <IconEyeOff />}</IconWrapper>} />
              </ListItem>
            ))}
          </List>
        </Stack>
      ))}
    </Stack>
  );
}

const IconWrapper = ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
  <IconButton
    onClick={onClick}
    sx={{
      color: "customYellow.contrastText",
      bgcolor: "customYellow.main",
      "&:hover": {
        bgcolor: "customYellow.dark",
      },
      borderRadius: "8px",
    }}
  >
    {children}
  </IconButton>
);
