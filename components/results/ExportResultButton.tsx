"use client";

import type { SessionSnapshot } from "@/types";
import { JsonDownloadButton } from "./JsonDownloadButton";

export function ExportResultButton({ snapshot }: { snapshot: SessionSnapshot }) {
  return <JsonDownloadButton label="导出 JSON" filename={`sensitivity-result-${snapshot.id}.json`} data={snapshot} pretty />;
}
