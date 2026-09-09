import { notFound } from "next/navigation";
import { AssetPreviewLoader } from "./preview-loader";

export default function AssetDesignPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <AssetPreviewLoader />;
}
