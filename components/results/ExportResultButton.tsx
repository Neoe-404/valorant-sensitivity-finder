"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import type { SessionSnapshot } from "@/types";

export function ExportResultButton({ snapshot }: { snapshot: SessionSnapshot }) {
  const [failed, setFailed] = useState(false);

  const download = () => {
    setFailed(false);
    const link = document.createElement("a");
    let url: string | undefined;
    try {
      const json = JSON.stringify(snapshot, null, 2);
      url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      link.href = url;
      link.download = `sensitivity-result-${snapshot.id}.json`;
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
    } catch {
      setFailed(true);
    } finally {
      link.remove();
      if (url) {
        const downloadUrl = url;
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      }
    }
  };

  return (
    <div>
      <button type="button" className="btn-ghost" onClick={download}>
        <Download size={16} /> 导出 JSON
      </button>
      {failed ? <p role="alert" className="mt-2 text-xs text-warn">无法启动下载，请重试。</p> : null}
    </div>
  );
}
