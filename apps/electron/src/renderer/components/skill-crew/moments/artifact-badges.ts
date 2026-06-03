const WRITER_ARTIFACT_PREFIX = 'writer_artifact:'

export function isWriterArtifactTag(artifact: string): boolean {
  return artifact.startsWith(WRITER_ARTIFACT_PREFIX)
}

export function formatArtifactBadge(artifact: string): string {
  return isWriterArtifactTag(artifact)
    ? artifact.slice(WRITER_ARTIFACT_PREFIX.length)
    : artifact
}
