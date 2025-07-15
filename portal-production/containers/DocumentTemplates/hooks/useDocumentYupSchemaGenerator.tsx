/* eslint-disable @typescript-eslint/no-explicit-any */
import * as yup from "yup";

export default function useDocumentYupSchemaGenerator(defaultValues: any, requiredFields: any) {
  const buildSchema = (values: any, rules: any): any => {
    const shape: Record<string, any> = {};

    for (const key in values) {
      const fieldValue = values[key];
      const rule = rules?.[key];

      const isRequired = rule === true;

      if (key === "items") {
        // Hardcoded validation for the items array
        shape[key] = yup
          .array()

          .min(1, "At least one item is required");
        continue;
      }

      if (typeof fieldValue === "object" && fieldValue !== null && !Array.isArray(fieldValue)) {
        shape[key] = yup.object(buildSchema(fieldValue, rule));
      } else if (typeof fieldValue === "string") {
        shape[key] = isRequired ? yup.string().trim().required(`This field is required`) : yup.string().notRequired();
      } else if (typeof fieldValue === "number") {
        shape[key] = isRequired ? yup.number().typeError(`This field is required`).required(`This field is required`) : yup.number().notRequired();
      } else {
        shape[key] = isRequired ? yup.mixed().required(`This field is required`) : yup.mixed().notRequired();
      }
    }

    return shape;
  };

  return yup.object().shape(buildSchema(defaultValues, requiredFields));
}
