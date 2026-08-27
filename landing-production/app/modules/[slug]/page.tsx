import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Nav } from "../../_components/Nav";
import { Footer } from "../../_components/Footer";
import { Cta } from "../../_components/Cta";
import { FeatureRows, MoreModules, PageHero, PromptStrip, StatsStrip } from "../../_components/PageBlocks";
import { MODULE_BY_SLUG, MODULE_PAGES } from "../../_content/modules";
import { LogoStrip } from "../../_components/LogoStrip";
import type { ModuleKey } from "../../_content/site";

export function generateStaticParams() {
  return MODULE_PAGES.map((m) => ({ slug: m.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const m = MODULE_BY_SLUG[params.slug as ModuleKey];
  if (!m) return {};
  return { title: `${m.name} | AIMS`, description: m.lede };
}

export default function ModulePage({ params }: { params: { slug: string } }) {
  const m = MODULE_BY_SLUG[params.slug as ModuleKey];
  if (!m) notFound();
  return (
    <>
      <Nav />
      <main>
        <PageHero eyebrow={m.eyebrow} title={m.title} lede={m.lede} screen={m.heroScreen} badge={m.badge} />
        <StatsStrip stats={m.stats} />
        {m.slug === "accounting" ? <LogoStrip label="Bring your books from" /> : null}
        <FeatureRows features={m.features} />
        <PromptStrip prompts={m.prompts} />
        <MoreModules current={m.slug} />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
