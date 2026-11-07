import { redirect } from "next/navigation";

/** Old address of the department timetable: it is now the Attendance page's first view. */
export default async function DepartmentTodayPage(props: PageProps<"/today">) {
  const sp = await props.searchParams;
  const q = new URLSearchParams({ view: "timetable" });
  if (typeof sp.day === "string") q.set("day", sp.day);
  if (typeof sp.dept === "string") q.set("dept", sp.dept);
  redirect(`/attendance?${q}`);
}
