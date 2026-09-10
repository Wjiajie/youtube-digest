import { notFound } from "next/navigation";
import { EnvironmentStudyLoader } from "./study-loader";

export default function EnvironmentDesignPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <EnvironmentStudyLoader />;
}
