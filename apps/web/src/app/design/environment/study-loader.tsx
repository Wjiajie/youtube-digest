"use client";

import dynamic from "next/dynamic";
const EnvironmentStudy = dynamic(() => import("./environment-study"), { ssr: false,
  loading: () => <p role="status">正在准备环境构图工具……</p> });
export function EnvironmentStudyLoader() { return <EnvironmentStudy />; }
