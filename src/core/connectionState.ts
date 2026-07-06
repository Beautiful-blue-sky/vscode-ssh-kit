export function canUseCachedSshKitWindowConnection(remoteName: string | undefined): boolean {
  return remoteName === "ssh-remote";
}
