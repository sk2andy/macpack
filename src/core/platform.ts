export function assertMacOS(): void {
  if (process.platform !== "darwin") {
    throw new Error("macpack only runs on macOS.");
  }
}

export function isMacOS(): boolean {
  return process.platform === "darwin";
}
