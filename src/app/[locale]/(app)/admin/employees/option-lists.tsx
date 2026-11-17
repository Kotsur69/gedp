import type { ManagerOption } from "@/server/employee-admin";

// Suggestions for the manager AMEI and department inputs, rendered ONCE per page and shared by the
// filter form and the edit window through `list=` ids (a large organisation means a long list).
// No hooks and no directive: usable from both the server page and client components.

export const MANAGER_OPTIONS_ID = "employee-manager-options";
export const DEPARTMENT_OPTIONS_ID = "employee-department-options";

type OptionListsProps = { managers: readonly ManagerOption[]; departments: readonly string[] };

export function OptionLists({ managers, departments }: OptionListsProps) {
  return (
    <>
      <datalist id={MANAGER_OPTIONS_ID}>
        {managers.map((manager) => (
          <option key={manager.amei} value={manager.amei} label={`${manager.name} (${manager.amei})`} />
        ))}
      </datalist>
      <datalist id={DEPARTMENT_OPTIONS_ID}>
        {departments.map((department) => (
          <option key={department} value={department} />
        ))}
      </datalist>
    </>
  );
}
