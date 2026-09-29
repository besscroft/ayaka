/** Write a UI stream to its parent before starting the next model stream. */
export async function writeStreamSequentially<T>(
  stream: ReadableStream<T>,
  write: (chunk: T) => void,
): Promise<void> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      write(value);
    }
  } finally {
    reader.releaseLock();
  }
}
