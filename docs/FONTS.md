# Project fonts

Open a scene, enable **Game UI**, and expand **Project fonts** in the right inspector.
Use **Import TTF / OTF** to embed a single OpenType font. The optional family field can
name the authoring family; otherwise the importer reads the font's internal Unicode
family name. Importing that family again replaces its bytes while preserving its ID.
Select a text node and choose **Use for selected text** to prepend the family to its
ordered fallback list. The text inspector can edit the complete list.

Font bytes and license name/text/source URL/redistribution status belong to `.bbbproj`.
Import, replacement, removal and license changes support Undo/Redo. Save/Open restores
the same bytes. Imports stage real browser font decoding before publishing a command;
a project change discards an older import's result. Font preview uses private family
aliases so replaced bytes do not collide with other loaded faces. Scene and Logic
preview use the same font resolver.

Imports begin with **Unverified** redistribution status. Add the complete font notice
and the applicable name, then record the reviewed status. Native diagnostics preserve
these author-supplied values and report missing/restricted notices and embedding flags;
they do not determine legal permission. Export automatically packages unmodified
bundled Noto Sans Arabic and its complete OFL notice when that family is referenced.
Runtime playback can use those packaged bytes without font-network requests.

Single `.ttf`/`.otf` files are bounded to 4 MiB each, 32 files and 16 MiB total. Collections,
WOFF and unsupported Unicode cmap formats need conversion. Structural glyph inspection
does not prove all dynamic/localized strings; preview representative text on the target.

SVG text export resolves **internal** font names, independently of an optional authoring
alias. Explicit font buffers must cover its literal family list and characters. Inline
inherited family declarations and first-buffer generic fallback are accepted; missing
families/glyphs, ambiguous faces, variation sequences and unresolved text CSS receive
actionable errors. Convert unsupported SVG text styling to paths. The browser fixture
checks real RTL/mixed-script resvg pixels and canonical/inherited/generic equivalence.
