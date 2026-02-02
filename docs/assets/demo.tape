# VHS tape file for Reader demo GIF
# Run: vhs docs/assets/demo.tape

Output docs/assets/demo.gif

Set FontSize 16
Set Width 900
Set Height 500
Set Theme "Catppuccin Mocha"
Set Padding 20

# Scrape a URL and extract the markdown
Type "npx reader scrape https://reader.dev | jq -r '.data[0].markdown' | head -n 12"
Sleep 500ms
Enter
Sleep 3s

# Let output display
Sleep 3s
