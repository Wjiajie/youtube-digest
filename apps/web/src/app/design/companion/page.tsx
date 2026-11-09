import { notFound } from "next/navigation";
import { CompanionHome } from "@/components/companion/companion-home";
import { CompanionSettings } from "@/components/companion/companion-settings";
export default async function CompanionPreview({
  searchParams,
}: {
  searchParams: Promise<{ settings?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  return (await searchParams).settings ? (
    <CompanionSettings preview />
  ) : (
    <CompanionHome preview />
  );
}
