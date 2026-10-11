"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { TextareaField } from "@/components/ui/textarea-field";
import {
  boothPayload,
  FormError,
  resourceLabels,
  type Booth,
} from "@/lib/booths/form";

export function BoothEditor({
  booth,
  version,
  locked,
  onDirty,
  onSave,
}: {
  booth: Booth | null;
  version: number;
  locked: boolean;
  onDirty: () => void;
  onSave: (payload: Record<string, unknown>) => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <form
      className="booth-editor"
      noValidate
      onChange={onDirty}
      onSubmit={(event) => {
        event.preventDefault();
        if (locked) return;
        try {
          const payload = boothPayload(
            new FormData(event.currentTarget),
            version,
          );
          setErrors({});
          onSave(payload);
        } catch (error) {
          if (error instanceof FormError) {
            setErrors({ [error.field]: error.message });
            document.getElementById(`booth-${error.field}`)?.focus();
          }
        }
      }}
    >
      <h3>{booth ? `${booth.booth_no} 부스 수정` : "부스 등록"}</h3>
      <fieldset disabled={locked} className="booth-fields">
        <legend className="sr-only">부스 시설과 상태</legend>
        <Field
          id="booth-booth_no"
          name="booth_no"
          label="부스 번호"
          defaultValue={booth?.booth_no ?? ""}
          error={errors.booth_no}
          required
        />
        <Field
          id="booth-zone"
          name="zone"
          label="구역 (선택)"
          defaultValue={booth?.zone ?? ""}
        />
        <Field
          id="booth-table_capacity"
          name="table_capacity"
          label="테이블 수용 개수 (선택)"
          inputMode="numeric"
          defaultValue={booth?.table_capacity ?? ""}
          hint="비워 두면 수용 개수 미확인으로 저장돼요."
          error={errors.table_capacity}
        />
        <div className="field">
          <label htmlFor="booth-status">부스 상태</label>
          <select
            className="input"
            id="booth-status"
            name="status"
            defaultValue={booth?.status ?? "AVAILABLE"}
          >
            <option value="AVAILABLE">사용 가능</option>
            <option value="BLOCKED">사용 중지</option>
          </select>
        </div>
        <div className="booth-facilities">
          {Object.entries(resourceLabels).map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                name={key}
                defaultChecked={
                  booth?.[key as keyof typeof resourceLabels] ?? false
                }
              />
              {label}
            </label>
          ))}
        </div>
        <TextareaField
          id="booth-note"
          name="note"
          label="부스 메모 (선택)"
          defaultValue={booth?.note ?? ""}
        />
        <Field
          id="booth-reason"
          name="reason"
          label="등록·수정 사유"
          error={errors.reason}
          required
        />
        <Button type="submit" disabled={locked}>
          {booth ? "부스 수정 저장" : "부스 등록 저장"}
        </Button>
      </fieldset>
    </form>
  );
}
