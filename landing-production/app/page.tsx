import { Nav } from "./_components/Nav";
import { Hero } from "./_components/Hero";
import { Proof } from "./_components/Proof";
import { Modules } from "./_components/Modules";
import { Agent } from "./_components/Agent";
import { Trades } from "./_components/Trades";
import { Platform } from "./_components/Platform";
import { LogoStrip } from "./_components/LogoStrip";
import { Cta } from "./_components/Cta";
import { Footer } from "./_components/Footer";

/** Home: the desk (one message, four papers) → the agent (how Confirm works)
 *  → the modules → who it is for → what sits underneath → closing band. */
export default function Page() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Agent />
        <Proof />
        <Modules />
        <Trades />
        <Platform />
        <LogoStrip label="Move your books from" />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
