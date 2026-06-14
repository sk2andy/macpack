import { cancel, confirm, isCancel } from "@clack/prompts";

export async function confirmOrCancel(message: string, initialValue = true): Promise<boolean> {
  const answer = await confirm({ message, initialValue });
  if (isCancel(answer)) {
    cancel("Cancelled.");
    process.exit(130);
  }
  return answer;
}
