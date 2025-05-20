import { NotificationsProvider } from "../context/NotificationsContext";
import Portal from "../components/Portal";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Portal>
          <NotificationsProvider>{children}</NotificationsProvider>
        </Portal>
      </body>
    </html>
  );
}
