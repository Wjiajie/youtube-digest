import { notFound } from "next/navigation";
import { ThemeSpecimen } from "./theme-specimen";

export default function DesignPage() {
  // Internal specimens must not become an unreviewed public product experience.
  if (process.env.NODE_ENV !== "development") notFound();
  return <ThemeSpecimen />;
}
