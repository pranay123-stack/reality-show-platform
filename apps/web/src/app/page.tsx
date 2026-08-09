import { SiteHeader } from '@/components/marketing/site-header';
import {
  ClosingCta,
  ContestantPreview,
  Hero,
  HowItWorks,
  InteractiveFeatures,
  LeaderboardPreview,
  Rewards,
  SiteFooter,
} from '@/components/marketing/sections';

export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Hero />
        <HowItWorks />
        <InteractiveFeatures />
        <ContestantPreview />
        <Rewards />
        <LeaderboardPreview />
        <ClosingCta />
      </main>
      <SiteFooter />
    </>
  );
}
