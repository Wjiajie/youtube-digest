"use client";

import dynamic from "next/dynamic";

const AvatarSpike = dynamic(
  () => import("./avatar-spike").then((module) => module.AvatarSpike),
  {
    ssr: false,
    loading: () => <div className="avatar-spike-loading">正在准备化身舞台…</div>,
  },
);

export function AvatarSpikeLoader() {
  return <AvatarSpike />;
}
