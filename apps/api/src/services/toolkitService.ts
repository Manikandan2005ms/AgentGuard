import type { AgentResult, PaymentRequestDTO, RuleResult } from "@agentguard/shared";
import { emptyPolicy } from "@agentguard/shared";
import type { Prisma } from "@prisma/client";
import { explainDecision } from "../ai/explain";
import { detectInjection } from "../ai/injectionDetect";
import { checkIntent } from "../ai/intentCheck";
import { decideWithBaseline, type DecideInput } from "../core/decide";
import { visibleExcerpt } from "../core/injectionHeuristics";
import { inQuietHours, mergeStrictest } from "../core/policyEngine";
import { scoreRisk, INJECTION_LLM_THRESHOLD } from "../core/riskEngine";
import { classifyTool, describeToolCall, evaluateToolRules, toolAmount, toolkitError, type ToolClass } from "../core/toolPolicy";
import { prisma } from "../db";
import { publish } from "../events";
import { findTool, runToolkitTool } from "../paypal/toolkit";
import { toDTO, withRelations, type PaymentRow } from "./dto";
import { notifier } from "./notify";
import { serialized, toAgentResult, updatePayment } from "./paymentService";
import { getActivePolicy, getUser } from "./users";

/**
 * Guarded PayPal Agent Toolkit calls (R2). Read-only tools pass straight through; everything
 * that changes money or data goes through the same firewall as payments: deterministic rules
 * first, AI checks that can only escalate, human approval on Telegram/dashboard, full audit.
 */

export const TOOLKIT_MERCHANT = "paypal-agent-toolkit";

/** Extra, optional arguments AgentGuard accepts on every toolkit tool. */
export const GUARD_FIELDS = ["agentguard_task_id", "agentguard_source_content"] as const;

function splitArgs(raw: Record<string, unknown>) {
  const { agentguard_task_id, agentguard_source_content, ...args } = raw;
  return {
    taskId: typeof agentguard_task_id === "string" ? agentguard_task_id : null,
    source: typeof agentguard_source_content === "string" ? agentguard_source_content : null,
    args,
  };
}

export async function callPayPalTool(name: string, raw: Record<string, unknown>): Promise<unknown> {
  if (!findTool(name)) throw new Error(`Unknown PayPal toolkit tool: ${name}`);
  const { taskId, source, args } = splitArgs(raw);
  const cls = classifyTool(name);

  // Read-only: pass through unchanged, so agents built for PayPal's MCP get PayPal's own output.
  if (cls === "read") return runToolkitTool(name, args);

  return serialized(async () => {
    const user = await getUser();
    const active = await getActivePolicy(user.id);
    const policy = active?.policy ?? emptyPolicy();
    const task = taskId ? await prisma.task.findFirst({ where: { id: taskId, userId: user.id } }) : null;
    const now = new Date();

    // A full refund doesn't state an amount; look the capture up in our own audit log.
    let amount = toolAmount(name, args);
    if (amount == null && name === "create_refund" && typeof args.capture_id === "string") {
      const paid = await prisma.paymentRequest.findFirst({ where: { paypalCaptureId: args.capture_id } });
      if (paid) amount = Number(paid.amount);
    }
    const summary = describeToolCall(name, args, amount);

    const [injection, intent] = await Promise.all([
      detectInjection(source),
      task
        ? checkIntent(task.description, { item: summary, quantity: 1, merchant: "PayPal (Agent Toolkit)", amount: amount ?? 0, currency: "USD", category: "other" })
        : Promise.resolve(null),
    ]);

    const pre: RuleResult[] = [];
    if (user.killSwitch) pre.push({ rule_id: "kill_switch", outcome: "block", detail: "Kill switch is on: all agent actions that move money or change data are frozen." });
    if (!active && cls !== "write") pre.push({ rule_id: "no_active_policy", outcome: "ask", detail: "You have no active policy, so this action needs your approval." });
    if (!task && cls !== "write") {
      pre.push({ rule_id: "task_bound", outcome: "ask", detail: "This action isn't tied to a task, so its intent can't be checked." });
    }
    const q = policy.time_rules.quiet_hours;
    if (q && inQuietHours(now, q.start, q.end, policy.timezone)) {
      pre.push({ rule_id: "quiet_hours", outcome: q.action, detail: `It is inside your quiet hours (${q.start}–${q.end}).` });
    }

    const llmInjection = !!injection.llm?.detected && (injection.llm?.score ?? 0) >= INJECTION_LLM_THRESHOLD;
    const baseRules = [...pre, ...evaluateToolRules({ name, cls, amount, policy, injectionInSource: injection.heuristic.detected })];
    const fullRules = mergeStrictest(baseRules, evaluateToolRules({ name, cls, amount, policy, injectionInSource: injection.heuristic.detected || llmInjection }));

    const riskBase = { amount: amount ?? 0, avgAmount: null, merchantAgeDays: null, merchantPaidBefore: true, category: "other" as const, velocity: null, quietHours: false };
    const baseRisk = scoreRisk({
      ...riskBase,
      injection: { heuristicHit: injection.heuristic.detected, llmScore: null },
      intent: intent ? { aligned: intent.heuristic.aligned, reason: intent.heuristic.reason } : null,
    });
    const fullRisk = scoreRisk({
      ...riskBase,
      injection: { heuristicHit: injection.heuristic.detected, llmScore: injection.llm?.detected ? injection.llm.score : null },
      intent: intent ? { aligned: intent.aligned, reason: intent.reason } : null,
    });

    const baseline: DecideInput = {
      killSwitch: user.killSwitch,
      rules: baseRules,
      score: baseRisk.score,
      injectionDetected: baseRisk.injectionDetected,
      intentAligned: intent?.heuristic.aligned ?? null,
      aiCheckFailed: false,
    };
    const full: DecideInput = {
      killSwitch: user.killSwitch,
      rules: fullRules,
      score: Math.max(baseRisk.score, fullRisk.score),
      injectionDetected: baseRisk.injectionDetected || fullRisk.injectionDetected,
      intentAligned: intent?.aligned ?? null,
      aiCheckFailed: !!(intent?.llmError || injection.llmError),
    };
    const decided = decideWithBaseline(baseline, full);
    const signals = fullRisk.score >= baseRisk.score ? fullRisk.signals : baseRisk.signals;

    const explanation = await explainDecision({
      decision: decided.decision,
      item: summary,
      merchant: "PayPal (via Agent Toolkit)",
      amount: amount ?? 0,
      currency: "USD",
      riskScore: full.score,
      reasons: decided.reasons,
      rules: fullRules,
      signals,
      injectionTechniques: full.injectionDetected ? injection.evidence.map((e) => e.technique) : [],
      kind: "paypal_tool",
    });

    const created = await prisma.paymentRequest.create({
      data: {
        kind: "paypal_tool",
        toolName: name,
        toolArgs: args as Prisma.InputJsonValue,
        userId: user.id,
        taskId: task?.id ?? null,
        merchantDomain: TOOLKIT_MERCHANT,
        item: summary,
        category: cls,
        amount: amount ?? 0,
        sourceExcerpt: source ? visibleExcerpt(source) : null,
        decision: decided.decision,
        riskScore: full.score,
        signals: signals as unknown as Prisma.InputJsonValue,
        rulesFired: fullRules as unknown as Prisma.InputJsonValue,
        aiChecks: {
          policyId: active?.id ?? null,
          baselineDecision: decided.baseline,
          reasons: decided.reasons,
          toolClass: cls,
          intentReason: intent?.reason ?? null,
          injectionHeuristicScore: injection.heuristic.score,
          injectionLlmScore: injection.llm?.score ?? null,
          injectionEvidence: injection.evidence,
          engines: { intent: intent?.engine ?? "skipped (no task)", injection: injection.llm ? "heuristics+llm" : "heuristics", explainer: explanation.engine },
        } as unknown as Prisma.InputJsonValue,
        injectionDetected: full.injectionDetected,
        intentAligned: intent?.aligned ?? null,
        explanation: explanation.text,
        status: decided.decision === "BLOCK" ? "BLOCKED" : decided.decision === "ASK_HUMAN" ? "HELD" : "PENDING",
        resolvedAt: decided.decision === "BLOCK" ? new Date() : null,
      },
      include: withRelations,
    });
    publish({ type: "payment.created", payment: toDTO(created) });

    if (decided.decision === "BLOCK") {
      if (full.injectionDetected || full.score >= 70) void notifier.blocked(toDTO(created)).catch(() => null);
      return toolAgentResult(toDTO(created), cls);
    }
    if (decided.decision === "ASK_HUMAN") {
      const msgId = await notifier.approvalNeeded(toDTO(created)).catch(() => null);
      const row = msgId ? await updatePayment(created.id, { telegramMessageId: msgId }) : created;
      return toolAgentResult(toDTO(row), cls);
    }
    const done = await executeTool(created, "engine");
    return toolAgentResult(toDTO(done), cls);
  });
}

/** Runs the held (or auto-approved) toolkit call against PayPal and records the outcome. */
export async function executeTool(row: PaymentRow, decidedBy: string): Promise<PaymentRow> {
  try {
    const result = await runToolkitTool(row.toolName!, (row.toolArgs ?? {}) as Record<string, unknown>);
    const failed = toolkitError(result);
    return updatePayment(row.id, {
      status: failed ? "FAILED" : "PAID",
      toolResult: result as Prisma.InputJsonValue,
      ...(failed ? { failureReason: `PayPal toolkit call failed: ${failed}` } : {}),
      decidedBy,
      resolvedAt: new Date(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return updatePayment(row.id, { status: "FAILED", failureReason: `PayPal toolkit call failed: ${message}`, decidedBy, resolvedAt: new Date() });
  }
}

export function toolAgentResult(p: PaymentRequestDTO, cls: ToolClass): AgentResult {
  const r = toAgentResult(p);
  const reason = p.status === "FAILED" && p.failureReason ? `${p.failureReason} (your policy allowed it)` : r.reason;
  return { ...r, tool: p.toolName ?? undefined, paypal_result: p.toolResult ?? undefined, reason: `${reason} (${cls.replace("_", " ")} action)` };
}
