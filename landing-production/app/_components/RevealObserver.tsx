"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Fades in every [data-reveal] element the first time it scrolls into view.
 *  The hidden state only applies once the inline script in layout.tsx has set
 *  data-js on <html>, so the page reads fine without JavaScript. */
export function RevealObserver() {
  const pathname = usePathname();
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]:not([data-in])"));
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => { el.dataset.in = "1"; });
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          (en.target as HTMLElement).dataset.in = "1";
          io.unobserve(en.target);
        });
      },
      { rootMargin: "0px 0px -60px 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pathname]);
  return null;
}
