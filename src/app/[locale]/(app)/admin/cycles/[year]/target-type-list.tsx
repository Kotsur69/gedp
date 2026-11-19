"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { TargetTypeIcon } from "@/components/goals/target-type-icon";
import { ChevronDownIcon, ChevronUpIcon, PencilIcon, PlusIcon } from "@/components/shell/icons";
import { DEFAULT_TARGET_TYPE, MAX_NAME_LENGTH, moveTargetTypeSchema, targetTypeSchema } from "@/domain/cycle-config";
import { moveTargetTypeAction, saveTargetTypeAction } from "../actions";
import { CheckboxField, TextField } from "../cycle-fields";
import { FormStatus, ICON_BUTTON, PRIMARY_BUTTON, SECONDARY_BUTTON, useCycleSave, useFieldError } from "../cycle-form-kit";
import { ActiveBadge } from "./catalog-list";
import { useInlineEditor } from "./use-inline-editor";

// Target types of a cycle (HR-05, Part 2): the list behind "Typ celu", in the order HR sets with
// the up / down buttons (keyboard-operable, no drag and drop). The code is fixed once created; the
// numeric flag is fixed while goals use the type; the default type ("Tekst") stays active.

const MAX_CODE_LENGTH = 30;

export type TargetTypeItem = {
  id: number;
  code: string;
  namePl: string;
  nameEn: string;
  isNumeric: boolean;
  isActive: boolean;
  usage: number;
};

type TargetTypeListProps = {
  cycleId: number;
  items: readonly TargetTypeItem[];
  isEditable: boolean;
};

export function TargetTypeList({ cycleId, items, isEditable }: TargetTypeListProps) {
  const t = useTranslations("admin.cycles.targetTypes");
  const tCatalog = useTranslations("admin.cycles.catalog");
  const editor = useInlineEditor("target-type");
  const moveState = useCycleSave();

  const move = (item: TargetTypeItem, direction: "up" | "down") =>
    moveState.save({
      schema: moveTargetTypeSchema,
      payload: { cycleId, id: item.id, direction },
      action: moveTargetTypeAction,
      fields: [],
    });

  return (
    <div>
      <ol className="grid gap-2">
        {items.map((item, index) =>
          editor.editing === item.id ? (
            <li key={item.id}>
              <TargetTypeForm cycleId={cycleId} item={item} onDone={editor.close} />
            </li>
          ) : (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-line bg-surface px-4 py-3"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-canvas text-accent">
                <TargetTypeIcon code={item.code} className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className={`font-semibold break-words ${item.isActive ? "text-ink" : "text-ink-soft"}`}>
                  {item.namePl}
                  <span className="sr-only">, {t("position", { position: index + 1, total: items.length })}</span>
                </p>
                <p className="text-sm text-ink-soft">
                  <span lang="en">{item.nameEn}</span>
                  <span aria-hidden="true"> · </span>
                  <code className="font-semibold tracking-wide">{item.code}</code>
                </p>
              </div>
              <span className="text-sm font-semibold text-ink-soft">
                {item.isNumeric ? t("numericBadge") : t("textBadge")}
              </span>
              <ActiveBadge isActive={item.isActive} />
              <span className="text-sm text-ink-soft tabular-nums">{tCatalog("usage", { count: item.usage })}</span>
              {isEditable && (
                <div className="flex gap-2">
                  <IconButton
                    label={t("moveUp", { name: item.namePl })}
                    isDisabled={index === 0 || moveState.isPending}
                    onClick={() => move(item, "up")}
                  >
                    <ChevronUpIcon className="size-4" />
                  </IconButton>
                  <IconButton
                    label={t("moveDown", { name: item.namePl })}
                    isDisabled={index === items.length - 1 || moveState.isPending}
                    onClick={() => move(item, "down")}
                  >
                    <ChevronDownIcon className="size-4" />
                  </IconButton>
                  <IconButton
                    id={editor.editButtonId(item.id)}
                    label={tCatalog("edit", { name: item.namePl })}
                    isDisabled={false}
                    onClick={() => editor.open(item.id)}
                  >
                    <PencilIcon className="size-4" />
                  </IconButton>
                </div>
              )}
            </li>
          ),
        )}
        {editor.editing === "new" && (
          <li>
            <TargetTypeForm cycleId={cycleId} item={null} onDone={editor.close} />
          </li>
        )}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {isEditable && editor.editing !== "new" && (
          <button id={editor.addButtonId} type="button" onClick={() => editor.open("new")} className={SECONDARY_BUTTON}>
            <PlusIcon className="size-5" />
            {tCatalog("add")}
          </button>
        )}
        <FormStatus state={moveState} />
      </div>
    </div>
  );
}

type IconButtonProps = { id?: string; label: string; isDisabled: boolean; onClick: () => void; children: ReactNode };

/** Icon-only button: the label is its accessible name and its tooltip. */
function IconButton({ id, label, isDisabled, onClick, children }: IconButtonProps) {
  return (
    <button
      id={id}
      type="button"
      onClick={() => !isDisabled && onClick()}
      aria-label={label}
      title={label}
      aria-disabled={isDisabled || undefined}
      className={ICON_BUTTON}
    >
      {children}
    </button>
  );
}

const FIELDS = ["code", "namePl", "nameEn", "isNumeric", "isActive"] as const;

type TargetTypeFormProps = {
  cycleId: number;
  item: TargetTypeItem | null;
  onDone: () => void;
};

function TargetTypeForm({ cycleId, item, onDone }: TargetTypeFormProps) {
  const t = useTranslations("admin.cycles.targetTypes");
  const tCatalog = useTranslations("admin.cycles.catalog");
  const [values, setValues] = useState({
    code: item?.code ?? "",
    namePl: item?.namePl ?? "",
    nameEn: item?.nameEn ?? "",
    isNumeric: item?.isNumeric ?? false,
    isActive: item?.isActive ?? true,
  });
  const state = useCycleSave();
  const errorOf = useFieldError(state.fieldErrors);
  const isBusy = state.isPending;
  const prefix = `target-type-${item?.id ?? "new"}`;
  const isNew = item === null;
  const isDefault = item?.code === DEFAULT_TARGET_TYPE.code;
  const isNumericLocked = (item?.usage ?? 0) > 0;
  const set = <K extends keyof typeof values>(field: K, value: (typeof values)[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
    state.markEdited();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    state.save({
      schema: targetTypeSchema,
      payload: { cycleId, id: item?.id ?? null, ...values },
      action: saveTargetTypeAction,
      fields: FIELDS,
      onSaved: onDone,
    });
  };

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      aria-label={item ? tCatalog("edit", { name: item.namePl }) : tCatalog("addTitle")}
      className="grid gap-4 rounded-2xl border border-accent/40 bg-surface p-4 shadow-panel md:grid-cols-3"
    >
      <TextField
        id={`${prefix}-code`}
        label={t("code")}
        hint={t("codeHint")}
        error={errorOf("code")}
        value={values.code}
        onChange={(value) => set("code", value)}
        maxLength={MAX_CODE_LENGTH}
        isUppercase
        isDisabled={!isNew}
        isBusy={isBusy}
        hasInitialFocus={isNew}
      />
      <TextField
        id={`${prefix}-namePl`}
        label={tCatalog("namePl")}
        error={errorOf("namePl")}
        value={values.namePl}
        onChange={(value) => set("namePl", value)}
        maxLength={MAX_NAME_LENGTH}
        isBusy={isBusy}
        hasInitialFocus={!isNew}
      />
      <TextField
        id={`${prefix}-nameEn`}
        label={tCatalog("nameEn")}
        error={errorOf("nameEn")}
        value={values.nameEn}
        onChange={(value) => set("nameEn", value)}
        maxLength={MAX_NAME_LENGTH}
        isBusy={isBusy}
      />
      <div className="grid gap-4 md:col-span-3 md:grid-cols-2">
        <CheckboxField
          id={`${prefix}-isNumeric`}
          label={t("numeric")}
          hint={t("numericHint")}
          error={errorOf("isNumeric")}
          checked={values.isNumeric}
          onChange={(checked) => set("isNumeric", checked)}
          isDisabled={isNumericLocked}
          isBusy={isBusy}
        />
        <CheckboxField
          id={`${prefix}-isActive`}
          label={tCatalog("active")}
          hint={isDefault ? t("defaultHint") : tCatalog("activeHint")}
          error={errorOf("isActive")}
          checked={values.isActive}
          onChange={(checked) => set("isActive", checked)}
          isDisabled={isDefault}
          isBusy={isBusy}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3 md:col-span-3">
        <button type="submit" aria-disabled={isBusy || undefined} aria-busy={isBusy || undefined} className={PRIMARY_BUTTON}>
          {tCatalog("save")}
        </button>
        <button
          type="button"
          onClick={() => !isBusy && onDone()}
          aria-disabled={isBusy || undefined}
          className={SECONDARY_BUTTON}
        >
          {tCatalog("cancel")}
        </button>
        <FormStatus state={state} />
      </div>
    </form>
  );
}
