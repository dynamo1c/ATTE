import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Field, SubmitButton } from "@/components/action-form";
import { Badge, Card, Input, NoAccess, PageHeader, Select } from "@/components/ui";
import { canManageClass, canViewClass } from "@/lib/auth/permissions";
import { addDays, formatDateShort, todayIn } from "@/lib/domain/dates";
import { activeVersion, isVersionEditable } from "@/lib/domain/timetable";
import { WEEKDAYS, listOfferings, listPeriods, listSlots, listVersions, type SlotRow } from "@/server/class-data";
import { requireStaff } from "@/server/current";
import { getClass, parseId } from "@/server/queries";
import { addSlot, createVersion, deleteSlot, deleteVersion } from "../../actions";

export default async function TimetablePage(props: PageProps<"/classes/[id]/timetable">) {
  const me = await requireStaff();
  const id = parseId((await props.params).id);
  const cls = id ? await getClass(id) : null;
  if (!cls) notFound();
  if (!canViewClass(me.actor, cls)) return <NoAccess what="this timetable" />;
  const canManage = canManageClass(me.actor, cls);
  const today = todayIn();

  const [versions, periods, offerings] = await Promise.all([listVersions(cls.id), listPeriods(), listOfferings(cls.id)]);
  const vParam = parseId(String((await props.searchParams).v ?? ""));
  const current = activeVersion(versions, today);
  const selected = versions.find((v) => v.id === vParam) ?? current ?? versions[0] ?? null;
  const slots = selected ? await listSlots(selected.id) : [];
  const editable = Boolean(selected && canManage && isVersionEditable(selected, today, selected.sessions));
  const maxPeriod = periods.length;

  return (
    <>
      <PageHeader title={`Timetable · ${cls.departmentCode} Sem ${cls.semester}`} back={{ href: `/classes/${cls.id}`, label: `${cls.departmentCode} Sem ${cls.semester}` }} />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Versions:</span>
        {versions.map((v) => (
          <Link
            key={v.id}
            href={`/classes/${cls.id}/timetable?v=${v.id}`}
            className={`rounded-md border px-2 py-1 ${v.id === selected?.id ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
          >
            From {formatDateShort(v.effectiveFrom)}
            {v.id === current?.id && " · in use"}
            {v.effectiveFrom > today && " · upcoming"}
          </Link>
        ))}
      </div>

      {selected ? (
        <Card
          title={
            <>
              From {formatDateShort(selected.effectiveFrom)} {editable ? <Badge tone="green">Editable</Badge> : <Badge>Locked — classes recorded</Badge>}
            </>
          }
          actions={
            editable && versions.length > 1 ? (
              <ActionForm action={deleteVersion} confirm="Delete this timetable version and all its periods?">
                <input type="hidden" name="versionId" value={selected.id} />
                <SubmitButton variant="danger" size="sm">
                  Delete version
                </SubmitButton>
              </ActionForm>
            ) : null
          }
        >
          {selected.note && <p className="mb-3 text-sm text-slate-500">{selected.note}</p>}
          <div className="-mx-4 overflow-x-auto px-4">
            <div className="min-w-[760px]">
              <div className="grid gap-1" style={{ gridTemplateColumns: `56px repeat(${maxPeriod}, minmax(0, 1fr))` }}>
                <div />
                {periods.map((p) => (
                  <div key={p.ordinal} className="pb-1 text-center text-xs text-slate-500">
                    <div className="font-medium text-slate-700">P{p.ordinal}</div>
                    {p.startsAt.slice(0, 5)}–{p.endsAt.slice(0, 5)}
                  </div>
                ))}
              </div>
              {[1, 2, 3, 4, 5, 6].map((day) => (
                <DayRow key={day} day={day} slots={slots.filter((s) => s.weekday === day)} maxPeriod={maxPeriod} editable={editable} />
              ))}
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Each block is one attendance session, however many periods it spans. <span className="rounded bg-violet-100 px-1">Lab</span>{" "}
            <span className="rounded bg-slate-200 px-1">Activity</span>
          </p>
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-slate-600">No timetable yet.</p>
        </Card>
      )}

      {editable && selected && (
        <Card title="Add to timetable" className="mt-6">
          <ActionForm action={addSlot} className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5 lg:items-end">
            <input type="hidden" name="versionId" value={selected.id} />
            <Field label="Day" name="weekday">
              <Select id="weekday" name="weekday">
                {[1, 2, 3, 4, 5, 6].map((d) => (
                  <option key={d} value={d}>
                    {WEEKDAYS[d]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="From period" name="startPeriod">
              <Select id="startPeriod" name="startPeriod">
                {periods.map((p) => (
                  <option key={p.ordinal} value={p.ordinal}>
                    P{p.ordinal} ({p.startsAt.slice(0, 5)})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="To period" name="endPeriod">
              <Select id="endPeriod" name="endPeriod">
                {periods.map((p) => (
                  <option key={p.ordinal} value={p.ordinal}>
                    P{p.ordinal} (till {p.endsAt.slice(0, 5)})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Type" name="kind">
              <Select id="kind" name="kind">
                <option value="CLASS">Class</option>
                <option value="ACTIVITY">Activity period</option>
              </Select>
            </Field>
            <Field label="Subject" name="offeringId">
              <Select id="offeringId" name="offeringId">
                {offerings.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.shortName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Part" name="component">
              <Select id="component" name="component">
                <option value="THEORY">Theory</option>
                <option value="PRACTICAL">Lab</option>
              </Select>
            </Field>
            <Field label="Batch" name="batchScope">
              <Select id="batchScope" name="batchScope">
                <option value="ALL">Whole class</option>
                <option value="B1">B1</option>
                <option value="B2">B2</option>
              </Select>
            </Field>
            <Field label="Room (optional)" name="room">
              <Input id="room" name="room" placeholder="Lab 2" />
            </Field>
            <SubmitButton>Add</SubmitButton>
          </ActionForm>
          <p className="mt-2 text-xs text-slate-500">Clashes are blocked: same batch twice in a period, or a teacher in two classes at once.</p>
        </Card>
      )}

      {canManage && (
        <Card title="Change the timetable from a date" className="mt-6">
          <p className="mb-3 text-sm text-slate-600">
            Classes already recorded keep their old timetable. A new version starts on the date you choose; copy the current one and then edit it.
          </p>
          <ActionForm action={createVersion} className="grid gap-3 sm:grid-cols-3 sm:items-end">
            <input type="hidden" name="classId" value={cls.id} />
            <Field label="Starts on" name="effectiveFrom">
              <Input id="effectiveFrom" name="effectiveFrom" type="date" min={addDays(today, 1)} defaultValue={addDays(today, 1)} />
            </Field>
            <Field label="Copy periods from" name="copyFrom">
              <Select id="copyFrom" name="copyFrom" defaultValue={current?.id ?? ""}>
                <option value="">Start empty</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    Version from {formatDateShort(v.effectiveFrom)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Note (optional)" name="note">
              <Input id="note" name="note" placeholder="Revised after HOD meeting" />
            </Field>
            <SubmitButton variant="secondary">Create new version</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}

function DayRow({ day, slots, maxPeriod, editable }: { day: number; slots: SlotRow[]; maxPeriod: number; editable: boolean }) {
  // Group parallel B1/B2 slots that share the same periods into one block.
  const groups = new Map<string, SlotRow[]>();
  for (const s of slots) {
    const key = `${s.startPeriod}-${s.endPeriod}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return (
    <div className="mt-1 grid gap-1 border-t border-slate-100 pt-1" style={{ gridTemplateColumns: `56px repeat(${maxPeriod}, minmax(0, 1fr))` }}>
      <div className="flex items-center text-sm font-medium text-slate-700" style={{ gridColumn: 1, gridRow: "1 / span 3" }}>
        {WEEKDAYS[day]}
      </div>
      {[...groups.values()].map((group) => {
        const { startPeriod, endPeriod } = group[0];
        return (
          <div key={`${startPeriod}-${endPeriod}`} className="flex min-h-14 flex-col gap-1" style={{ gridColumn: `${startPeriod + 1} / ${endPeriod + 2}` }}>
            {group.map((s) => (
              <div
                key={s.id}
                className={`relative rounded border px-2 py-1 text-xs ${
                  s.kind === "ACTIVITY" ? "border-slate-200 bg-slate-100 text-slate-600" : s.component === "PRACTICAL" ? "border-violet-200 bg-violet-50" : "border-blue-200 bg-blue-50"
                }`}
              >
                <div className="font-medium text-slate-900">
                  {s.kind === "ACTIVITY" ? "Activity" : s.subject}
                  {s.component === "PRACTICAL" && " Lab"}
                  {s.batchScope !== "ALL" && <span className="ml-1 rounded bg-white px-1 text-[10px] text-slate-700">{s.batchScope}</span>}
                </div>
                {s.teachers && <div className="truncate text-slate-500">{s.teachers}</div>}
                {s.room && <div className="text-slate-500">{s.room}</div>}
                {editable && (
                  <ActionForm action={deleteSlot} confirm="Remove this from the timetable?" className="absolute right-0.5 top-0.5">
                    <input type="hidden" name="slotId" value={s.id} />
                    <button type="submit" aria-label="Remove" className="rounded px-1 text-slate-400 hover:bg-red-100 hover:text-red-700">
                      ×
                    </button>
                  </ActionForm>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
