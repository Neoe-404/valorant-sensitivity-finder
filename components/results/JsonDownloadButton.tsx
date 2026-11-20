"use client";

import { useState } from "react";
import { Download } from "lucide-react";

interface JsonDownloadButtonProps {
  label: string;
  filename: string;
  data: unknown;
  pretty?: boolean;
}

export function JsonDownloadButton({ label, filename, data, pretty }: JsonDownloadButtonProps) {
  const [failed, setFailed] = useState(false);

  const download = () => {
    setFailed(false);
    const link = document.createElement("a");
    let url: string | undefined;
    try {
      const json = JSON.stringify(data, null, pretty ? 2 : undefined);
      url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      link.href = url;
      link.download = filename;
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
        <Download size={16} /> {label}
      </button>
      {failed ? <p role="alert" className="mt-2 text-xs text-warn">无法启动下载，请重试。</p> : null}
    </div>
  );
}
