# Whisper glossary rules

The glossary is a plain text file, one term per line, passed to whisper as a
prompt that biases its vocabulary. Keep it to the handful of names actually
being misheard: the bias dilutes across terms long before whisper's prompt cap
of around 224 tokens, so accuracy on any single name drops as the list grows.

- One glossary per vault, at `System/whisper-glossary.txt`, holding that vault's
  vocabulary. The assistant keeps a separate short one at
  `~/<Name>/config/whisper-glossary.txt` for voice notes, which are mostly your
  own voice saying the same dozen names.
- Reviews curate the glossary; they do not append to it. Add a name only after
  you have seen it mistranscribed, and drop terms whisper gets right on its own.
- When you know a recording's attendees in advance, pass a focused list for that
  batch with `WHISPER_GLOSSARY=/path/to/short-list.txt`.
- Never pass one business's glossary to a recording from another. It biases the
  transcript toward names that are not in the room.
- Keep the file under about twelve lines, or about forty words.
