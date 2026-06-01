import { ChevronDown, ChevronUp, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import type { PendingApproval } from "../types";
import { MarkdownText } from "./ChatPane";

interface ApprovalStackProps {
  approvals: PendingApproval[];
  detailsCollapsedByDefault: boolean;
  onApprove: (id: string | number) => Promise<void>;
  onReject: (id: string | number) => Promise<void>;
  onAlwaysAllow: (id: string | number) => Promise<void>;
}

export function ApprovalStack({ approvals, detailsCollapsedByDefault, onApprove, onReject, onAlwaysAllow }: ApprovalStackProps) {
  if (!approvals.length) return null;

  return (
    <div className="approval-stack" aria-label="待审批请求">
      {approvals.map((approval) => (
        <ApprovalCard
          approval={approval}
          key={String(approval.id)}
          detailsCollapsedByDefault={detailsCollapsedByDefault}
          onApprove={onApprove}
          onAlwaysAllow={onAlwaysAllow}
          onReject={onReject}
        />
      ))}
    </div>
  );
}

function ApprovalCard({
  approval,
  detailsCollapsedByDefault,
  onApprove,
  onAlwaysAllow,
  onReject
}: {
  approval: PendingApproval;
  detailsCollapsedByDefault: boolean;
  onApprove: (id: string | number) => Promise<void>;
  onAlwaysAllow: (id: string | number) => Promise<void>;
  onReject: (id: string | number) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(!detailsCollapsedByDefault);
  const detailsId = `approval-details-${String(approval.id).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const reason = approvalReason(approval.params);

  useEffect(() => {
    setExpanded(!detailsCollapsedByDefault);
  }, [approval.id, detailsCollapsedByDefault]);

  return (
    <section className="approval-card">
      <div className="approval-card-header">
        <div className="approval-heading">
          <div className="approval-title-row">
            <ShieldAlert size={16} />
            <strong>敏感操作审批</strong>
          </div>
          <p>
            <span>{approvalSummary(approval.method)}</span>
            {reason ? <span className="approval-reason"> {reason}</span> : null}
          </p>
        </div>
        <button
          className="approval-toggle"
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "收起详情" : "展开详情"}
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>
      {expanded ? (
        <div className="approval-details" id={detailsId}>
          <MarkdownText text={approvalDetailsMarkdown(approval.params)} className="approval-details-markdown" />
        </div>
      ) : null}
      <div className="approval-actions">
        <button className="danger-action" type="button" onClick={() => void onReject(approval.id)}>拒绝</button>
        <button type="button" onClick={() => void onAlwaysAllow(approval.id)}>总是允许</button>
        <button className="primary-action" type="button" onClick={() => void onApprove(approval.id)}>批准</button>
      </div>
    </section>
  );
}

function approvalSummary(method: string): string {
  if (method.includes("commandExecution")) return "准备执行命令，请确认安全性。";
  if (method.includes("fileChange")) return "准备执行文件更改，请确认安全性。";
  return "准备执行敏感操作，请确认安全性。";
}

function approvalReason(params: unknown): string {
  if (!params || typeof params !== "object" || Array.isArray(params)) return "";
  const record = params as Record<string, unknown>;
  return typeof record.reason === "string" ? record.reason.trim() : "";
}

function approvalDetailsMarkdown(params: unknown): string {
  return `\`\`\`json\n${formatApprovalParams(params)}\n\`\`\``;
}

function formatApprovalParams(params: unknown): string {
  if (typeof params === "string") return params;
  try {
    return JSON.stringify(params ?? {}, null, 2);
  } catch {
    return String(params ?? "");
  }
}
