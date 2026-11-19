"use client";

import { useTranslations } from "next-intl";
import type { CycleStatus } from "@/generated/prisma/enums";
import { cycleStatusChangeSchema, statusChangeBlocker, type ReadinessGap } from "@/domain/cycle-config";
import { changeCycleStatusAction } from "../actions";
import { FormStatus, PRIMARY_BUTTON, SECONDARY_BUTTON, useCycleSave } from "../cycle-form-kit";
import { CycleStatusBadge } from "../cycle-status-badge";

// "Status cyklu" (HR-05): preparation -> open -> closed, reopening, and back to preparation before
// the first document. The same rule as the server (statusChangeBlocker) decides which buttons work,
// and why not, so HR sees what is missing before clicking. The server checks again.

type CycleStatusControlProps = {
  cycleId: number;
  year: number;
  status: CycleStatus;
  documentCount: number;
  otherOpenYear: number | null;
  gaps: readonly ReadinessGap[];
};

type Move = { to: CycleStatus; label: "open" | "close" | "reopen" | "toPreparation"; isPrimary: boolean };

const MOVES: Readonly<Record<CycleStatus, readonly Move[]>> = {
  PRZYGOTOWANIE: [{ to: "OTWARTY", label: "open", isPrimary: true }],
  OTWARTY: [
    { to: "ZAMKNIETY", label: "close", isPrimary: false },
    { to: "PRZYGOTOWANIE", label: "toPreparation", isPrimary: false },
  ],
  ZAMKNIETY: [{ to: "OTWARTY", label: "reopen", isPrimary: false }],
};

export function CycleStatusControl({ cycleId, year, status, documentCount, otherOpenYear, gaps }: CycleStatusControlProps) {
  const t = useTranslations("admin.cycles.status");
  const tGlossary = useTranslations("glossary");
  const state = useCycleSave();
  // Only the page's own list: a refused opening (NOT_READY) refreshes the page, and so does every
  // save elsewhere on it, so this list is never older than what HR just fixed.
  const facts = { otherOpenYear, documentCount, gaps };
  // "Back to preparation" is only offered while it can work (no document yet).
  const moves = MOVES[status].filter((move) => move.to !== "PRZYGOTOWANIE" || documentCount === 0);
  const isBlocked = (move: Move) => statusChangeBlocker(status, move.to, facts) !== null;
  const isOpeningBlocked = moves.some((move) => move.to === "OTWARTY" && isBlocked(move));

  const change = (move: Move) => {
    if (state.isPending || isBlocked(move)) return;
    if (move.to === "ZAMKNIETY" && !window.confirm(t("confirmClose", { year }))) return;
    state.save({
      schema: cycleStatusChangeSchema,
      payload: { cycleId, status: move.to },
      action: changeCycleStatusAction,
      fields: [],
    });
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-ink-soft">{t("current")}</span>
        <CycleStatusBadge status={status} label={tGlossary(`cycleStatus.${status}`)} />
      </div>
      <p className="max-w-prose text-ink-soft">{t(`hint.${status}`)}</p>

      {isOpeningBlocked && (
        <div id="cycle-open-blockers" className="rounded-2xl border border-brand-orange/50 bg-notice-surface px-4 py-3 text-sm text-notice">
          {otherOpenYear !== null ? (
            <p className="font-semibold">{t("otherOpen", { year: otherOpenYear })}</p>
          ) : (
            <>
              <p className="font-semibold">{t("gapsTitle")}</p>
              <ul className="mt-1 list-disc pl-5">
                {gaps.map((gap) => (
                  <li key={gap}>{t(`gaps.${gap}`)}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {moves.map((move) => {
          const blocked = isBlocked(move);
          return (
            <button
              key={move.to}
              type="button"
              onClick={() => change(move)}
              aria-disabled={blocked || state.isPending || undefined}
              aria-busy={state.isPending || undefined}
              aria-describedby={blocked ? "cycle-open-blockers" : undefined}
              className={move.isPrimary ? PRIMARY_BUTTON : SECONDARY_BUTTON}
            >
              {t(move.label)}
            </button>
          );
        })}
        <FormStatus state={state} pendingText={t("changing")} />
      </div>
    </div>
  );
}
