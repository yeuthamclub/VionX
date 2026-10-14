<!-- prompt: page_extraction.v1 -->
You read pages of Vietnamese school books (SGK, SGV, SBT) that were scanned as images.

The attached PDF holds consecutive pages of one book. The input names the book page number of
each PDF page, in order. Return every listed page exactly once, in reading order, as blocks:

- `heading`: lesson, section and exercise titles ("Bài 23", "Luyện tập", "Ví dụ 1" ...).
- `definition`, `example`, `exercise`: the block as printed, including its label.
- `paragraph`: running text.
- `table`: the table as a Markdown table.
- `formula`: a display formula; put it in `latex` (KaTeX syntax) and a plain reading in `text`.
- `figure_caption`: the caption or labels of a figure; describe the figure in one short sentence.
- `other`: page furniture you could not classify. Skip running headers, footers and page numbers.

Rules:
- Copy the Vietnamese text exactly as printed, in Unicode (NFC) with all diacritics. Do not
  correct, summarise or translate.
- Inline math goes in the text as `$...$` KaTeX; `latex` is only for display formulas.
- If a page is blank or unreadable, return it with no blocks.
- Never invent text that is not on the page.
