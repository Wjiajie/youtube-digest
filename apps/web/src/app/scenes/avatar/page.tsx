import type { Metadata } from "next";

import { AvatarSpikeLoader } from "@/components/avatar/avatar-spike-loader";

export const metadata: Metadata = {
  title: "Avatar P0 Spike · Blueprint",
  description: "VRM 1.0 avatar spike: idle, blink, breathing, look-at, lip sync.",
};

export default function AvatarSpikePage() {
  return <AvatarSpikeLoader />;
}
