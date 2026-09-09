"use client";

import dynamic from "next/dynamic";

const AssetPreview = dynamic(() => import("./asset-preview"), {
  ssr: false,
  loading: () => <p role="status">正在准备本地 3D 试装工具……</p>,
});

export function AssetPreviewLoader() { return <AssetPreview />; }
