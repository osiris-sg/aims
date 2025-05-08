/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import axios from "axios";

export function useGetCountries() {
  const [countries, setCountries] = useState<{ label: string; value: string }[]>([]);

  useEffect(() => {
    axios
      .get("https://restcountries.com/v3.1/all")
      .then((response) => {
        const countryList = response.data
          .map((country: any) => ({
            label: country.name.common,
            value: country.name.common,
          }))
          .sort((a: { label: string; value: string }, b: { label: string; value: string }) => a.label.localeCompare(b.label));

        setCountries(countryList);
      })
      .catch((error) => console.error("Error fetching countries:", error));
  }, []);

  return { countries };
}
