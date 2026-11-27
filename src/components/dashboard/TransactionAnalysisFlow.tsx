import { useEffect, useId, useState } from "react";
import {
  Blocks, FileSearch, Fingerprint, GitBranch, Landmark, Link2,
  ListChecks, ScanLine, SearchCheck, ShieldCheck,
} from "lucide-react";
import { useTransactionAnalysisCopy } from "@/i18n/transactionAnalysis";
import "./transaction-analysis.css";

type Rail = "bank" | "crypto";
const paths = [
  "M 290 100 H 325 Q 345 100 345 120 V 160 Q 345 180 365 180 H 405",
  "M 290 300 H 325 Q 345 300 345 280 V 240 Q 345 220 365 220 H 405",
  "M 635 200 H 735",
];

/** An explanatory diagram, independent of the actual case progress and findings. */
export const TransactionAnalysisFlow = ({ scope, complete }: { scope?: string | null; complete: boolean }) => {
  const copy = useTransactionAnalysisCopy();
  const [stage, setStage] = useState(0);
  const [selected, setSelected] = useState<Rail>(scope === "crypto" ? "crypto" : "bank");
  const id = useId();
  // The parent renders this only for CRM review/completed phases. Keep the
  // workflow running throughout review; only the CRM can end the investigation.
  const moving = !complete;
  const available: Rail[] = scope === "bank" ? ["bank"] : scope === "crypto" ? ["crypto"] : ["bank", "crypto"];
  const rail = available.includes(selected) ? selected : available[0];

  useEffect(() => {
    if (!moving) return;
    const timer = window.setInterval(() => setStage(value => (value + 1) % 4), 3200);
    return () => window.clearInterval(timer);
  }, [moving]);

  const stages = [copy("stage1"), copy("stage2"), copy("stage3"), copy("stage4")];
  const checks = rail === "bank" ? [
    [copy("bankCheck1"), copy("bankDetail1")],
    [copy("bankCheck2"), copy("bankDetail2")],
    [copy("bankCheck3"), copy("bankDetail3")],
  ] : [
    [copy("cryptoCheck1"), copy("cryptoDetail1")],
    [copy("cryptoCheck2"), copy("cryptoDetail2")],
    [copy("cryptoCheck3"), copy("cryptoDetail3")],
  ];
  const CheckIcons = [Fingerprint, GitBranch, SearchCheck];

  return (
    <div className="transaction-analysis" data-motion={moving ? "running" : "paused"} data-scope={scope === "bank" || scope === "crypto" ? scope : "both"}>
      <div className="ta-heading">
        <div>
          <p className="portal-overline">{copy("workflow")}</p>
          <h3>{copy("title")}</h3>
          <p className="ta-subtitle">{copy("subtitle")}</p>
        </div>
      </div>

      <div className="ta-map">
        <svg className="ta-connections" viewBox="0 0 1000 400" preserveAspectRatio="none" aria-hidden="true">
          {paths.map((path, index) => {
            const d = available.length === 1 && index < 2 ? "M 290 200 H 405" : path;
            return (
              <g key={index} className={`ta-route ta-route-${index}`}>
                <path className="ta-route-track" d={d} />
                <path className="ta-route-packet" d={d} pathLength="100" />
                <path className="ta-route-packet ta-route-packet-follow" d={d} pathLength="100" />
              </g>
            );
          })}
          <circle className="ta-junction" cx="345" cy="200" r="4" />
          <path className="ta-connector-spine" d="M 345 180 V 220" />
        </svg>

        {available.map(source => {
          const Icon = source === "bank" ? Landmark : Blocks;
          return (
            <button key={source} type="button" className={`ta-source ta-source-${source}`} aria-pressed={rail === source} aria-controls={`${id}-checks`} onClick={() => setSelected(source)}>
              <span className="ta-source-heading"><span className="ta-node-icon"><Icon size={20} /></span><span><strong>{copy(source)}</strong><span className="ta-node-meta">{copy(source === "bank" ? "bankMeta" : "cryptoMeta")}</span></span></span>
              <span className="ta-records">
                {[0, 1, 2].map(row => (
                  <span key={row} className="ta-record"><span className="ta-record-mark" aria-hidden="true" /><span>{copy(source === "bank" ? (["bankRow1", "bankRow2", "bankRow3"] as const)[row] : (["cryptoRow1", "cryptoRow2", "cryptoRow3"] as const)[row])}</span><span className="ta-record-bars" aria-hidden="true"><i /><i /><i /></span></span>
                ))}
              </span>
            </button>
          );
        })}

        <div className="ta-engine">
          <div className="ta-scanner" aria-hidden="true">
            <span className="ta-scanner-orbit" /><span className="ta-scanner-orbit ta-scanner-orbit-inner" />
            <span className="ta-scanner-sweep" />
            <span className="ta-scanner-point ta-scanner-point-a" /><span className="ta-scanner-point ta-scanner-point-b" /><span className="ta-scanner-point ta-scanner-point-c" />
            <Fingerprint size={29} />
          </div>
          <strong>{copy("engine")}</strong>
          <span className="ta-node-meta">{copy("engineMeta")}</span>
          <div className="ta-engine-bars" aria-hidden="true">{Array.from({ length: 15 }, (_, i) => <i key={i} style={{ animationDelay: `${i * -0.17}s`, height: `${8 + ((i * 7) % 19)}px` }} />)}</div>
        </div>

        <div className="ta-evidence">
          <span className="ta-node-icon"><FileSearch size={21} /></span>
          <strong>{copy("evidence")}</strong>
          <span className="ta-node-meta">{copy("evidenceMeta")}</span>
          <span className="ta-evidence-row"><Link2 size={15} />{copy("evidenceRow1")}</span>
          <span className="ta-evidence-row"><ListChecks size={15} />{copy("evidenceRow2")}</span>
        </div>
      </div>

      <ol className="ta-stages" aria-label={copy("workflow")}>
        {stages.map((label, index) => <li key={label} className={moving && stage === index ? "is-illustrating" : ""}><span className="ta-stage-number">{String(index + 1).padStart(2, "0")}</span><span>{label}</span><span className="ta-stage-track" aria-hidden="true" /></li>)}
      </ol>

      <section className="ta-checks" id={`${id}-checks`} aria-labelledby={`${id}-checks-title`}>
        <div className="ta-checks-heading"><ScanLine size={16} /><h4 id={`${id}-checks-title`}>{copy("details")}</h4><span>{copy(rail)}</span></div>
        <div className="ta-check-grid">
          {checks.map(([title, description], index) => {
            const Icon = CheckIcons[index];
            return <div key={title} className="ta-check"><Icon size={18} /><h5>{title}</h5><p>{description}</p></div>;
          })}
        </div>
      </section>
      <p className="ta-note"><ShieldCheck size={15} /><span>{copy("note")}</span></p>
    </div>
  );
};
