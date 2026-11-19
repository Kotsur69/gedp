// Pure text edits behind the markdown toolbar (HR-06): each returns the new text and the range to
// select afterwards, so HR can keep typing over the placeholder or the formatted text.

export interface TextEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Wraps the selection (or a placeholder when nothing is selected), e.g. **bold** or [text](url). */
export function wrapSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string,
  placeholder: string,
): TextEdit {
  const selected = value.slice(start, end) || placeholder;
  const selectionStart = start + before.length;
  return {
    value: value.slice(0, start) + before + selected + after + value.slice(end),
    selectionStart,
    selectionEnd: selectionStart + selected.length,
  };
}

/**
 * Puts a prefix ("## ", "- ") at the start of every line the selection touches; lines that
 * already carry it are left alone. A blank line gets the placeholder after the prefix.
 */
export function prefixLines(value: string, start: number, end: number, prefix: string, placeholder: string): TextEdit {
  // lastIndexOf treats -1 as 0, so a cursor at the very start needs its own case.
  const lineStart = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = value.indexOf("\n", end);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const edited = lines
    .map((line) => {
      if (line.startsWith(prefix)) return line;
      return line.trim() === "" ? prefix + placeholder : prefix + line;
    })
    .join("\n");
  const isSingleBlank = lines.length === 1 && lines[0].trim() === "";
  return {
    value: value.slice(0, lineStart) + edited + value.slice(lineEnd),
    // A placeholder is selected so typing replaces it; otherwise the whole edited block is.
    selectionStart: isSingleBlank ? lineStart + prefix.length : lineStart,
    selectionEnd: lineStart + edited.length,
  };
}
