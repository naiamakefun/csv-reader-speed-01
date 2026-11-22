# csv-reader-speed-01

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/naiamakefun/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/naiamakefun/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's csv-reader 1.0.0, built for the "Read broken CSV files faster, 21 November 2026" bounty ($100 in USDC). `solve.js` is a dependency-free ES module whose `run({text, header})` returns exactly csv-reader 1.0.0's answer — `{columns, rows, errors}` — for every input, under the same broken-row policy: a leading U+FEFF dropped, records ending at LF or CRLF, blank lines skipped, a lone CR outside quotes dropped (`stray_cr`), quoted fields with `""` escapes and CR/CRLF read as LF inside them, text after a closing quote appended as it stands (`quote_junk`), a quote that never closes read as a literal character with the rest of the field re-read as unquoted (`unterminated_quote`), and every row after the first padded or cut to the first record's width (`short_row` / `long_row`). `main.ts` is the house driver, kept as shipped: it reads `/input/cases.json`, answers each case with `run`, and writes `/output/answers.json`.

## Approach

csv-reader 1.0.0 reads one character at a time and builds each field a character at a time. This reader keeps the same single left-to-right pass and the same decisions, but bulk-skips everything clean:

- **Whole-line fast path.** A record with no quote and no CR of its own up to its line break — the common case — is sliced out of the text and split at its commas in native code. The next quote and the next CR are located with `indexOf` and memoized, so those native scans stay amortized over the text they skip.
- **Clean spans by slice.** Unquoted fields are scanned to their terminator and taken with one `slice`; a quoted field with no escapes and no CR inside is one `slice` too. Only a field that actually contains a `""` escape, a CR to rewrite as LF, junk after its closing quote, or a stray CR pays for segment-by-segment assembly.
- **The unterminated quote stays cheap.** The quoted scan remembers where the field opened; if no closing quote exists, the reader rewinds to just after the opening quote and re-reads the field as unquoted, exactly as the reference does — no re-scan of the file, no special case at the record level.
- **Errors stay lazy.** Error objects are created only when an error is met, in the reference's shapes and order; the ~97% of records that are clean never allocate one.

Correctness was checked against csv-reader 1.0.0 itself, not against the prose: the kit's practice set (against both the published expected answers and the oracle live), four further drawn sets from the competition's own generator, a hand-written adversarial corpus for every error code and edge (BOM handling, lone CRs inside and outside quotes, `""` at a field's end, junk after a closing quote, unterminated quotes at EOF and mid-file, short and long rows with and without a header, lines of only stray CRs), and 5,500 randomized fuzz inputs — 5,650 comparisons in all, every one identical under the scorer's canonical-JSON comparison.

## Measured

CPU time of `run()` over a whole set (6 cases, ~10M characters of CSV), the house baseline (csv-reader 1.0.0 behind its `solve.js`) and this entry measured in the same process on the same machine, interleaved rounds, medians of 9:

| set | csv-reader 1.0.0 | this entry | speedup |
| --- | ---: | ---: | ---: |
| practice set (10.19M chars) | 651.7 ms | 169.1 ms | 3.85× |
| drawn set "echo" (9.55M chars) | 584.7 ms | 161.8 ms | 3.61× |
| drawn set "foxtrot" (10.38M chars) | 541.7 ms | 170.0 ms | 3.19× |

For scale, the house's own timings on its hardware put csv-reader at 1.38 s of CPU per set, and the fastest public JavaScript parsers at 0.72–0.78 s — with answers that are not csv-reader's. This entry's answers are csv-reader's, byte for byte.

## Running it

Node 22, no dependencies, nothing to install:

```
MAKEFUN_INPUT_DIR=/path/to/input MAKEFUN_OUTPUT_DIR=/path/to/output node main.ts
```

reads `cases.json` from the input directory and writes `answers.json` to the output directory (the container mounts `/input` and `/output` by default).

## License

MIT — see `LICENSE`.
