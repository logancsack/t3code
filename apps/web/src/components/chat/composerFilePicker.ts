/**
 * Reading files out of the composer's file input.
 *
 * Attaching used to be possible only by paste or drag-and-drop, both pointer
 * gestures, so a phone — where screenshots are actually taken — had no way in.
 * A file input covers that, and on mobile `accept="image/*"` makes the browser
 * offer the photo library and camera alongside the file list.
 */

interface PickedFileInput {
  readonly files: ArrayLike<File> | null;
  value: string;
}

/**
 * Take the picked files, resetting the input so the same file can be picked again.
 *
 * Without the reset a second pick of the same file fires no change event, which
 * reads as the attach button being broken rather than as a no-op.
 */
export function takePickedFiles(input: PickedFileInput): File[] {
  const files = Array.from(input.files ?? []);
  input.value = "";
  return files;
}
