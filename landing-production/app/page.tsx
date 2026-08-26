import { Nav } from "./_components/Nav";
import { Hero } from "./_components/Hero";
import { Proof } from "./_components/Proof";
import { Modules } from "./_components/Modules";
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
        <Agent />
        <Platform />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
