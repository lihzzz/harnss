import type { ReactNode, SelectHTMLAttributes } from "react";
import { useId } from "react";
import { cn } from "@/lib/utils";
export const appInputClass = "w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
export function AppField({ label, children, hint }: { label: string; children: (id: string) => ReactNode; hint?: string }) {
  const id = useId();
  return <div className="min-w-0 space-y-1.5"><label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</label>{children(id)}{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>;
}
export function AppSelect(props: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={cn(appInputClass, props.className)} />; }
