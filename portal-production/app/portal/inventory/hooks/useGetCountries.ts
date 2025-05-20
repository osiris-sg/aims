import { useQuery } from "@tanstack/react-query";
import axios from "axios";

interface Country {
  name: {
    common: string;
  };
}

interface CountryOption {
  label: string;
  value: string;
}

export default function useGetCountries() {
  const { data: countries = [] } = useQuery<CountryOption[]>({
    queryKey: ["countries"],
    queryFn: async () => {
      try {
        const response = await axios.get<Country[]>("https://restcountries.com/v3.1/all");
        const countryList = response.data
          .map((country) => ({
            label: country.name.common,
            value: country.name.common,
          }))
          .sort((a, b) => a.label.localeCompare(b.label));

        return countryList;
      } catch (error) {
        console.error("Error fetching countries:", error);
        return [];
      }
    },
  });

  return { countries };
}
