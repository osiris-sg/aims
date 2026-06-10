/* eslint-disable @typescript-eslint/no-explicit-any */
import FormInputBox from "@/form-components/FormInputBox";
import { Drawer, Typography, Stack, Button, useTheme, IconButton } from "@mui/material";
import useAddSiteOfficeFormHandler from "../hooks/useAddSiteOfficeFormHandler";
import { useEffect } from "react";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";

interface AddSiteOfficeProps {
  open: boolean;
  onClose: () => void;
  siteOffice?: any;
}

export default function AddSiteOffice({ open, onClose, siteOffice }: AddSiteOfficeProps) {
  const { control, handleSubmit, onSubmit, fields, append, remove, isSubmitting, reset, fetchSiteOfficeById } = useAddSiteOfficeFormHandler({
    onSuccess: onClose,
  });
  const theme = useTheme();

  // Reset form when drawer closes or clear for new Site Office
  useEffect(() => {
    if (!open) {
      reset();
    } else if (!siteOffice?.id) {
      reset({
        name: "",
        address: "",
        contactDetails: [{ name: "", email: "", phone: "" }],
      });
    }
  }, [open, siteOffice, reset]);

  const handleClose = () => {
    reset();
    onClose();
  };

  useEffect(() => {
    const fetchAndPopulate = async () => {
      if (siteOffice?.id) {
        const data = await fetchSiteOfficeById(siteOffice.id);
        if (data) {
          reset({
            name: data.name || "",
            address: data.address || "",
            contactDetails: data.contactDetails || [{ name: "", email: "", phone: "" }],
          });
        }
      }
    };
    fetchAndPopulate();
  }, [siteOffice, reset, fetchSiteOfficeById]);

  return (
    <Drawer anchor="right" open={open} onClose={handleClose} sx={{ "& .MuiDrawer-paper": { width: "400px", backgroundColor: "background.paper", backgroundImage: "none", borderLeft: 1, borderColor: "divider" } }}>
      <Stack direction="column" gap="var(--double-gap)" padding="var(--default-padding)" height="100%" width="100%" display="flex" alignItems="center" justifyContent="center">
        <Typography variant="body1" sx={{ width: "100%" }}>
          Add Site Office
        </Typography>
        <form style={{ width: "100%" }} onSubmit={handleSubmit(onSubmit)}>
          <Stack direction="column" gap="var(--default-gap)" width="100%">
            <FormInputBox control={control} name="name" label="Site Office Name" placeHolder="Enter name" />
            <FormInputBox control={control} name="address" label="Address" placeHolder="Enter address" />
            <Typography variant="body2" fontWeight="bold" sx={{ mt: 1 }}>
              Contact Person(s)
            </Typography>
            {fields.map((field, index) => (
              <Stack key={field.id} direction="column" gap="var(--quarter-gap)" sx={{ border: 1, borderColor: "divider", p: 1, borderRadius: 2 }}>
                <FormInputBox control={control} name={`contactDetails.${index}.name`} label="Name" placeHolder="Enter name" />
                <FormInputBox control={control} name={`contactDetails.${index}.email`} label="Email" placeHolder="Enter email" />
                <FormInputBox control={control} name={`contactDetails.${index}.phone`} label="Phone" placeHolder="Enter phone number" />
                <IconButton onClick={() => remove(index)} size="small" color="error" sx={{ alignSelf: "flex-end" }}>
                  <RemoveIcon />
                </IconButton>
              </Stack>
            ))}
            <Button onClick={() => append({ name: "", email: "", phone: "" })} startIcon={<AddIcon />} sx={{ mt: 1 }}>
              Add Contact Person
            </Button>
          </Stack>
          <Stack
            direction="row"
            width="100%"
            sx={{
              justifyContent: "space-between",
              py: "var(--quarter-gap)",
              mt: "var(--double-gap)",
            }}
          >
            <Button variant="outlined" type="button" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </Button>

            <Button variant="contained" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save"}
            </Button>
          </Stack>
        </form>
      </Stack>
    </Drawer>
  );
}
