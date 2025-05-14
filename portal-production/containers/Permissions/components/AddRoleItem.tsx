// /containers/Permissions/components/AddRoleItem.tsx
import React from "react";
import { Box, Button, Drawer, Grid, Typography } from "@mui/material";
import { useForm } from "react-hook-form";
import FormInputBox from "@/form-components/FormInputBox";
import FormTextarea from "@/form-components/FormTextArea";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function AddRoleItem({ open, onClose }: Props) {
  const { control, handleSubmit, reset, formState: { errors } } = useForm({
    defaultValues: {
      name: "",
      description: "",
    },
  });

  const onSubmit = async (data: any) => {
    try {
      // Call your API to create a new role
      const response = await fetch('/api/roles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        throw new Error('Failed to create role');
      }
      
      // Reset form and close drawer after successful creation
      reset();
      onClose();
      
      // You might want to refresh the roles list here
    } catch (error) {
      console.error("Error creating role:", error);
    }
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Box sx={{ width: 450, p: 3 }}>
        <form onSubmit={handleSubmit(onSubmit)}>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 3, height: "100%" }}>
            <Typography variant="h5">Create New Role</Typography>
            
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <FormInputBox
                  label="Role Name"
                  control={control}
                  name="name"
                  placeHolder="Enter role name"
                  rules={{ required: "Role name is required" }}
                  error={!!errors.name}
                  helperText={errors.name?.message as string}
                />
              </Grid>
              
              <Grid item xs={12}>
                <FormTextarea
                  label="Description"
                  control={control}
                  name="description"
                  placeHolder="Enter role description"
                  rows={4}
                />
              </Grid>
            </Grid>
            
            <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 2, mt: 2 }}>
              <Button variant="outlined" onClick={() => {
                reset();
                onClose();
              }}>
                Cancel
              </Button>
              <Button type="submit" variant="contained" color="primary">
                Create Role
              </Button>
            </Box>
          </Box>
        </form>
      </Box>
    </Drawer>
  );
}