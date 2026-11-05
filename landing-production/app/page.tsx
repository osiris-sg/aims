import { Nav } from "./_components/Nav";
import { Hero } from "./_components/Hero";
import { Marquee } from "./_components/Marquee";
import { Proof } from "./_components/Proof";
import { UseCases } from "./_components/UseCases";
import { Modules } from "./_components/Modules";
import { Agent } from "./_components/Agent";
import { Platform } from "./_components/Platform";
import { LogoStrip } from "./_components/LogoStrip";
import { Cta } from "./_components/Cta";
import { Footer } from "./_components/Footer";

export default function Page() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Marquee />
        <Proof />
        <UseCases />
        <Modules />
        <Agent />
        <Platform />
        <LogoStrip label="Move your books from" />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
