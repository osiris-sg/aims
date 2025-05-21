// "use client";
import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import "./globals.css";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { CssBaseline, ThemeProvider } from "@mui/material";
import theme from "@/themes/lightTheme";
import Head from "next/head";
import { ClerkProvider } from "@clerk/nextjs";
import Portal from "@/containers/portal";
import ReduxProvider from "./ReduxProvider";
import Providers from "./providers";

const roboto = Roboto({
  weight: ["300", "400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-roboto",
});

export const metadata: Metadata = {
  title: "AIMS",
  description: "AIMS provides a semaless flow for inventory managment",
  icons: { icon: "/favicon.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <Head>
          <link rel="icon" href="/favicon.png" type="image/png" />
        </Head>
        <body className={`${roboto.variable} ROOT_LAYOUT`}>
          <ReduxProvider>
            <AppRouterCacheProvider>
              <ThemeProvider theme={theme}>
                <CssBaseline />
                <Providers>
                <Portal>{children}</Portal>
                </Providers>
              </ThemeProvider>
            </AppRouterCacheProvider>
          </ReduxProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
