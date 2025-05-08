"use client";
import store from "@/store";
import React from "react";
import { Provider } from "react-redux";
interface Props {
  children: React.ReactNode;
}
export default function ReduxProvider(props: Props) {
  const { children } = props;
  return <Provider store={store}>{children}</Provider>;
}
