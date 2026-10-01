/** Fill {{merge.fields}} in email templates. Unknown fields are left blank. */
export function renderTemplate(text: string, vars: Record<string, Record<string, string | null | undefined>>) {
  return text.replace(/\{\{\s*(\w+)\.(\w+)\s*\}\}/g, (_, obj: string, key: string) => vars[obj]?.[key] ?? "");
}
