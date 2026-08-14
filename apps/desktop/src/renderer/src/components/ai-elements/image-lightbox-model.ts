export interface ImageSaveSource {
  src: string;
  workspacePath?: string;
}

export type ReadWorkspaceImage = (input: {
  conversationId: string;
  path: string;
}) => Promise<{ data: ArrayBuffer }>;

export async function readImageData(
  source: ImageSaveSource,
  conversationId: string | undefined,
  readWorkspace: ReadWorkspaceImage,
): Promise<ArrayBuffer> {
  if (conversationId && source.workspacePath) {
    return (
      await readWorkspace({
        conversationId,
        path: source.workspacePath,
      })
    ).data;
  }

  const response = await fetch(source.src);
  if (!response.ok) {
    throw new Error(`Image request failed with status ${response.status}.`);
  }
  return response.arrayBuffer();
}

export function wrapImageIndex(index: number, direction: -1 | 1, length: number): number {
  if (length <= 0) return 0;
  return (index + direction + length) % length;
}

export function clampImageIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}
