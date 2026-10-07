# <Name>, the executive assistant (see ~/<Name>/CLAUDE.md)
# The Telegram gateway (launchd, always on) is the only process polling the
# bot. The alias only loads the gateway's channel server into the session.
alias <name>='cd ~/<Name> && claude --add-dir "$HOME/Dev/<Personal>/_obsidian" --mcp-config "$HOME/<Name>/gateway/mcp.json" --dangerously-load-development-channels server:<name>-telegram'
alias <name>-resume='cd ~/<Name> && claude --resume --mcp-config "$HOME/<Name>/gateway/mcp.json" --dangerously-load-development-channels server:<name>-telegram'

# The author's pair, for comparison, with the assistant named Tanya:
#   alias tanya='cd ~/Tanya && claude --add-dir "$HOME/Dev/<Personal>/_obsidian" --mcp-config "$HOME/Tanya/gateway/mcp.json" --dangerously-load-development-channels server:tanya-telegram'
#   alias tanya-resume='claude --resume --mcp-config "$HOME/Tanya/gateway/mcp.json" --dangerously-load-development-channels server:tanya-telegram'
#
# Without Telegram, drop the --mcp-config and
# --dangerously-load-development-channels flags and keep the rest.
