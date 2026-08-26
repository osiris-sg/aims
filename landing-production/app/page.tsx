import { Nav } from "./_components/Nav";
import { Hero } from "./_components/Hero";
import { Proof } from "./_components/Proof";
import { Modules } from "./_components/Modules";
import { FieldBand } from "./_components/FieldBand";
import { AccountantBand } from "./_components/AccountantBand";
import { Agent } from "./_components/Agent";
import { Platform } from "./_components/Platform";
import { Cta } from "./_components/Cta";
import { Footer } from "./_components/Footer";

export default function Page() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Proof />
        <Modules />
        <FieldBand />
        <AccountantBand />
        <Agent />
        <Platform />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
