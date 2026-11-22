// A faster drop-in for csv-reader 1.0.0: run(input) returns exactly csv-reader 1.0.0's answer for every input —
// {columns, rows, errors} for the input {text, header} — by the same broken-row policy:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled, "" inside it one quote, and each
//     CRLF or lone CR inside it is read as LF; what follows its closing quote, up to the next comma or line break,
//     is appended as it stands (quote_junk, when the field ends); a quote that never closes is read as a literal
//     character and the text after it is read again as an unquoted field (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the records after it (every record
//     when header is false), each padded with "" (short_row, with fields: its count) or cut (long_row, with extra:
//     the cut fields) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record starts on (every LF, CRLF and lone CR
//     inside a quoted field counted), row its record's index in rows (null for the header), in the order met.
//
// The reader is a memoized walk: every unquoted field is taken with one native indexOf(',') plus two memoized
// positions — the first LF and the first CR at or after the point each was found, refreshed only once the
// reader has moved past them, so each native scan is amortized over the fields it certifies. Quoted fields keep
// a segment scan (their escapes and CR rewrites are the rare, irregular work). Nothing is kept from one call to
// the next.

// How a field ended: at a comma (the record goes on), at a line break, or at the end of the text.
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // How the field just read ended, and how many characters the last unquoted read kept.
  let fEnded = END;
  let fAdded = 0;

  // Memoized positions of the next LF and the next CR at or after the point they were found (n: none left).
  // Each is the first such character at or after some earlier position, so one at or after pos is exact, and
  // one behind pos is recomputed there — every native scan is amortized over the span it certifies.
  let nextLf = -1;
  let nextCr = -1;

  // Reads an unquoted field onto `value` (usually ''), starting at pos: characters up to the next comma or line
  // break, a CR not followed by LF dropped (stray_cr). Sets fEnded and fAdded (the characters this read kept).
  function readUnquoted(value) {
    const start = pos;
    if (nextLf < start) {
      nextLf = text.indexOf('\n', start);
      if (nextLf === -1) nextLf = n;
    }
    if (nextCr < start) {
      nextCr = text.indexOf('\r', start);
      if (nextCr === -1) nextCr = n;
    }
    const c1 = text.indexOf(',', start);
    if (c1 !== -1 && c1 < nextLf && c1 < nextCr) {
      pos = c1 + 1;
      fEnded = COMMA;
      fAdded = c1 - start;
      const span = text.slice(start, c1);
      return value === '' ? span : value + span;
    }
    if (nextCr < nextLf && (c1 === -1 || nextCr < c1)) {
      // The first special is a CR: the CRLF's (its LF is nextLf, one past it), or a stray CR.
      if (text.charCodeAt(nextCr + 1) === 10) {
        pos = nextCr + 2;
        line += 1;
        fEnded = LINE_BREAK;
        fAdded = nextCr - start;
        const span = text.slice(start, nextCr);
        return value === '' ? span : value + span;
      }
      return readUnquotedSegments(value, start);
    }
    if (nextLf < n) {
      pos = nextLf + 1;
      line += 1;
      fEnded = LINE_BREAK;
      fAdded = nextLf - start;
      const span = text.slice(start, nextLf);
      return value === '' ? span : value + span;
    }
    pos = n;
    fEnded = END;
    fAdded = n - start;
    const span = text.slice(start, n);
    return value === '' ? span : value + span;
  }

  // The segmented unquoted read, once a stray CR is known to sit inside the field: clean segments between one
  // special character and the next, the stray CRs dropped (stray_cr), joined at the end. Same walk as
  // readUnquoted, segment by segment.
  function readUnquotedSegments(value, start) {
    const parts = [value];
    let added = 0;
    let seg = start;
    let i = start;
    while (true) {
      if (nextLf < i) {
        nextLf = text.indexOf('\n', i);
        if (nextLf === -1) nextLf = n;
      }
      if (nextCr < i) {
        nextCr = text.indexOf('\r', i);
        if (nextCr === -1) nextCr = n;
      }
      const c1 = text.indexOf(',', i);
      if (c1 !== -1 && c1 < nextLf && c1 < nextCr) {
        parts.push(text.slice(seg, c1));
        added += c1 - seg;
        pos = c1 + 1;
        fEnded = COMMA;
        fAdded = added;
        return parts.join('');
      }
      if (nextCr < nextLf && (c1 === -1 || nextCr < c1)) {
        if (text.charCodeAt(nextCr + 1) === 10) {
          parts.push(text.slice(seg, nextCr));
          added += nextCr - seg;
          pos = nextCr + 2;
          line += 1;
          fEnded = LINE_BREAK;
          fAdded = added;
          return parts.join('');
        }
        // A stray CR: keep what precedes it, drop it, read on.
        parts.push(text.slice(seg, nextCr));
        added += nextCr - seg;
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        i = nextCr + 1;
        seg = i;
        continue;
      }
      if (nextLf < n) {
        parts.push(text.slice(seg, nextLf));
        added += nextLf - seg;
        pos = nextLf + 1;
        line += 1;
        fEnded = LINE_BREAK;
        fAdded = added;
        return parts.join('');
      }
      parts.push(text.slice(seg, n));
      added += n - seg;
      pos = n;
      fEnded = END;
      fAdded = added;
      return parts.join('');
    }
  }

  // Reads a quoted field whose opening quote is at pos. Sets fEnded.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let i = pos + 1;
    let seg = i; // the start of the clean segment being scanned
    let parts = null; // clean segments and the characters they join, once an escape or a CR appears
    let value = '';
    let closed = false;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 34) {
        if (text.charCodeAt(i + 1) === 34) {
          if (parts === null) parts = [text.slice(seg, i)];
          else parts.push(text.slice(seg, i));
          parts.push('"');
          i += 2;
          seg = i;
          continue;
        }
        if (parts === null) value = text.slice(seg, i);
        else {
          parts.push(text.slice(seg, i));
          value = parts.join('');
        }
        i += 1;
        closed = true;
        break;
      }
      if (c === 13) {
        // CRLF and a lone CR inside quotes are each one LF.
        if (parts === null) parts = [text.slice(seg, i)];
        else parts.push(text.slice(seg, i));
        parts.push('\n');
        line += 1;
        i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
        seg = i;
        continue;
      }
      if (c === 10) line += 1;
      i += 1;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    pos = i;
    if (pos >= n) {
      fEnded = END;
      return value;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fEnded = COMMA;
      return value;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fEnded = LINE_BREAK;
      return value;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fEnded = LINE_BREAK;
      return value;
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    const junk = readUnquoted(value);
    if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  // The width step every record but a skipped one goes through: the first record sets the width (and is the
  // header when header is true); a later record is padded or cut to it, with its error.
  function finishRecord(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    const fields = [];
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      fields.push(quoted ? readQuoted() : readUnquoted(''));
    } while (fEnded === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    finishRecord(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
