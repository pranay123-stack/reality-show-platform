import { HouseSpotlight } from '@/components/marketing/house-spotlight';
import { LiveArena } from '@/components/marketing/live-arena';
import { ProfileWidget } from '@/components/marketing/profile-widget';
import { SiteHeader } from '@/components/marketing/site-header';
import {
  ClosingCta,
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
        {/*
          Order is the argument. What is happening right now, then who it is
          happening to, then how to take part, then what you get for it — a
          visitor who bounces after two screens has still seen the product.
        */}
        <Hero />
        <LiveArena />
        <HouseSpotlight />
        <InteractiveFeatures />
        <ProfileWidget />
        <HowItWorks />
        <Rewards />
        <LeaderboardPreview />
        <ClosingCta />
      </main>
      <SiteFooter />
    </>
  );
}
