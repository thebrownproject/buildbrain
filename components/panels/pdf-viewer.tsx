"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";

const SAMPLE_PDFS = [
  { name: "Finish Schedule", file: "/pdfs/Clinic_076_Finish Schedule.pdf" },
  { name: "Equipment Schedule", file: "/pdfs/Clinic_070_Equipment Schedule.pdf" },
  { name: "Site Layout Plan", file: "/pdfs/Clinic_007_Site Layout Plan.pdf" },
] as const;

export function PDFViewer() {
  const [selectedPdf, setSelectedPdf] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-[36px] shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-3">
        {SAMPLE_PDFS.map((pdf) => (
          <button
            key={pdf.file}
            type="button"
            onClick={() => setSelectedPdf(pdf.file)}
            className={cn(
              "shrink-0 cursor-pointer rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors duration-100",
              selectedPdf === pdf.file
                ? "bg-bg-muted text-text-primary"
                : "text-text-muted hover:bg-bg-muted hover:text-text-secondary"
            )}
          >
            {pdf.name}
          </button>
        ))}
      </div>
      {selectedPdf ? (
        <iframe src={selectedPdf} className="min-h-0 flex-1" title="PDF Viewer" />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <FileText className="h-8 w-8 text-text-muted opacity-40" />
          <div>
            <p className="text-[13px] font-medium text-text-secondary">No document loaded</p>
            <p className="mt-1 text-[12px] text-text-muted">Select a PDF above or ask BuildBrain to find one</p>
          </div>
        </div>
      )}
    </div>
  );
}
