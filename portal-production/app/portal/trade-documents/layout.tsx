import TradeTheme from "@/app/portal/shipments/_components/TradeTheme";

// Green "done" states in light mode too (see TradeTheme).
export default function Layout({ children }: { children: React.ReactNode }) {
  return <TradeTheme>{children}</TradeTheme>;
}
