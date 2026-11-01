import { redirect } from "next/navigation";

/** Agents is Mondo's home: every Claude session on the PC, with what needs you first. */
export default function Page() {
  redirect("/agents");
}
