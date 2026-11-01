import FormInputBox from "@/form-components/FormInputBox";
import FormTextArea from "@/form-components/FormTextArea";
import { Drawer, Typography, Stack, Button, useTheme } from "@mui/material";
import { useForm } from "react-hook-form";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { useTranslations } from "next-intl";

interface AddDocumentProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddDocument({ open, onClose, onSuccess }: AddDocumentProps) {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const theme = useTheme();
  const t = useTranslations("invoices.addDocument");

  const { control, handleSubmit, reset } = useForm({
    defaultValues: {
      name: "",
      status: "",
      category: "",
      content: "",
    },
  });

  const onSubmit = async (data: any) => {
    try {
      const token = await getToken();
      if (!token || !organization?.id) return;

      const response = await request(
        {
          path: "/documents/create",
          method: "POST",
        },
        {
          ...data,
          organizationId: organization.id,
        },
        token
      );

      if (response.success) {
        reset();
        onClose();
        onSuccess();
      }
    } catch (error) {
      console.error("Error submitting form:", error);
    }
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose} sx={{ "& .MuiDrawer-paper": { width: { xs: "100%", sm: "400px" }, backgroundColor: "background.paper", backgroundImage: "none", borderLeft: 1, borderColor: "divider" } }}>
      <Stack direction="column" gap="var(--double-gap)" padding="var(--default-padding)" minHeight="100%" width="100%" display="flex" alignItems="center" justifyContent="flex-start">
        <Typography variant="body1" sx={{ width: "100%" }}>
          {t("title")}
        </Typography>
        <form style={{ width: "100%" }} onSubmit={handleSubmit(onSubmit)}>
          <Stack direction="column" gap="var(--default-gap)" width="100%">
            <FormInputBox control={control} name="name" label={t("name")} placeHolder={t("namePh")} />
            <FormInputBox control={control} name="status" label={t("status")} placeHolder={t("statusPh")} />
            <FormInputBox control={control} name="category" label={t("category")} placeHolder={t("categoryPh")} />
            <FormTextArea control={control} name="content" label={t("content")} placeHolder={t("contentPh")} rows={4} />
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
            <Button variant="outlined" type="button" onClick={onClose}>
              {t("cancel")}
            </Button>

            <Button variant="contained" type="submit">
              {t("save")}
            </Button>
          </Stack>
        </form>
      </Stack>
    </Drawer>
  );
}
