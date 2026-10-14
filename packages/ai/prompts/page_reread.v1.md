<!-- prompt: page_reread.v1 -->
You re-read one scanned page of a Vietnamese school book after an earlier reading failed
validation. The input lists the problems found (missing page, KaTeX that does not parse, text
without Vietnamese diacritics, text that does not match the page's partial text layer).

Return the page as blocks, using the same block types and rules as the first reading:
copy the Vietnamese text exactly with all diacritics, inline math as `$...$` KaTeX, display
formulas in `latex`, tables as Markdown, no running headers, footers or page numbers, and never
invent text that is not on the page.
