"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { PencilIcon, PlusIcon } from "@/components/shell/icons";
import { catalogItemSchema, MAX_NAME_LENGTH, type CatalogKind } from "@/domain/cycle-config";
import { saveCatalogItemAction } from "../actions";
import { CheckboxField, TextField } from "../cycle-fields";
import { FormStatus, ICON_BUTTON, PRIMARY_BUTTON, SECONDARY_BUTTON, useCycleSave, useFieldError } from "../cycle-form-kit";
import { useInlineEditor } from "./use-inline-editor";

// Competency catalogue and development areas of a cycle (HR-05, Part 3): PL / EN names and the
// active flag, edited one row at a time. There is no delete: goals keep their entry, so HR retires
// an entry by deactivating it, which takes it out of new goals.

export type CatalogItem = {
  id: number;
  namePl: string;
  nameEn: string;
  isActive: boolean;
  usage: number;
};

type CatalogListProps = {
  cycleId: number;
  kind: CatalogKind;
  items: readonly CatalogItem[];
  isEditable: boolean;
};

export function CatalogList({ cycleId, kind, items, isEditable }: CatalogListProps) {
  const t = useTranslations("admin.cycles.catalog");
  const editor = useInlineEditor(kind);

  return (
    <div>
      {items.length === 0 && editor.editing !== "new" && <p className="text-ink-soft">{t("empty")}</p>}
      <ul className="grid gap-2">
        {items.map((item) =>
          editor.editing === item.id ? (
            <li key={item.id}>
              <CatalogItemForm cycleId={cycleId} kind={kind} item={item} onDone={editor.close} />
            </li>
          ) : (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-line bg-surface px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className={`font-semibold break-words ${item.isActive ? "text-ink" : "text-ink-soft"}`}>{item.namePl}</p>
                <p lang="en" className="text-sm break-words text-ink-soft">
                  {item.nameEn}
                </p>
              </div>
              <ActiveBadge isActive={item.isActive} />
              <span className="text-sm text-ink-soft tabular-nums">{t("usage", { count: item.usage })}</span>
              {isEditable && (
                <button
                  id={editor.editButtonId(item.id)}
                  type="button"
                  onClick={() => editor.open(item.id)}
                  aria-label={t("edit", { name: item.namePl })}
                  title={t("edit", { name: item.namePl })}
                  className={ICON_BUTTON}
                >
                  <PencilIcon className="size-4" />
                </button>
              )}
            </li>
          ),
        )}
        {editor.editing === "new" && (
          <li>
            <CatalogItemForm cycleId={cycleId} kind={kind} item={null} onDone={editor.close} />
          </li>
        )}
      </ul>
      {isEditable && editor.editing !== "new" && (
        <button
          id={editor.addButtonId}
          type="button"
          onClick={() => editor.open("new")}
          className={`${SECONDARY_BUTTON} mt-3`}
        >
          <PlusIcon className="size-5" />
          {t("add")}
        </button>
      )}
    </div>
  );
}

/** "Aktywna" / "Nieaktywna": text first, tone only reinforces it. */
export function ActiveBadge({ isActive }: { isActive: boolean }) {
  const t = useTranslations("admin.cycles.catalog");
  const tone = isActive ? "border-accent/50 text-accent" : "border-line-strong text-ink-soft";
  return (
    <span className={`inline-flex min-h-7 items-center rounded-full border px-3 text-sm font-semibold ${tone}`}>
      {isActive ? t("activeBadge") : t("inactiveBadge")}
    </span>
  );
}

const FIELDS = ["namePl", "nameEn", "isActive"] as const;

type CatalogItemFormProps = {
  cycleId: number;
  kind: CatalogKind;
  item: CatalogItem | null;
  onDone: () => void;
};

function CatalogItemForm({ cycleId, kind, item, onDone }: CatalogItemFormProps) {
  const t = useTranslations("admin.cycles.catalog");
  const [values, setValues] = useState({
    namePl: item?.namePl ?? "",
    nameEn: item?.nameEn ?? "",
    isActive: item?.isActive ?? true,
  });
  const state = useCycleSave();
  const errorOf = useFieldError(state.fieldErrors);
  const isBusy = state.isPending;
  const prefix = `${kind}-${item?.id ?? "new"}`;
  const set = <K extends keyof typeof values>(field: K, value: (typeof values)[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
    state.markEdited();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    state.save({
      schema: catalogItemSchema,
      payload: { cycleId, kind, id: item?.id ?? null, ...values },
      action: saveCatalogItemAction,
      fields: FIELDS,
      onSaved: onDone,
    });
  };

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      aria-label={item ? t("edit", { name: item.namePl }) : t("addTitle")}
      className="grid gap-4 rounded-2xl border border-accent/40 bg-surface p-4 shadow-panel md:grid-cols-2"
    >
      <TextField
        id={`${prefix}-namePl`}
        label={t("namePl")}
        error={errorOf("namePl")}
        value={values.namePl}
        onChange={(value) => set("namePl", value)}
        maxLength={MAX_NAME_LENGTH}
        isBusy={isBusy}
        hasInitialFocus
      />
      <TextField
        id={`${prefix}-nameEn`}
        label={t("nameEn")}
        error={errorOf("nameEn")}
        value={values.nameEn}
        onChange={(value) => set("nameEn", value)}
        maxLength={MAX_NAME_LENGTH}
        isBusy={isBusy}
      />
      <div className="md:col-span-2">
        <CheckboxField
          id={`${prefix}-isActive`}
          label={t("active")}
          hint={t("activeHint")}
          error={errorOf("isActive")}
          checked={values.isActive}
          onChange={(checked) => set("isActive", checked)}
          isBusy={isBusy}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <button type="submit" aria-disabled={isBusy || undefined} aria-busy={isBusy || undefined} className={PRIMARY_BUTTON}>
          {t("save")}
        </button>
        <button
          type="button"
          onClick={() => !isBusy && onDone()}
          aria-disabled={isBusy || undefined}
          className={SECONDARY_BUTTON}
        >
          {t("cancel")}
        </button>
        <FormStatus state={state} />
      </div>
    </form>
  );
}
