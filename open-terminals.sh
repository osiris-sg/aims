#!/bin/bash

# Function to open terminal in specific directory
open_terminal() {
    local dir=$1
    local title=$2
    
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS - using Terminal.app
        osascript -e "tell application \"Terminal\"
            do script \"cd '$PWD/$dir' && echo '=== $title Terminal ===' && exec zsh\"
        end tell"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux - using gnome-terminal (adjust for your terminal)
        gnome-terminal --working-directory="$PWD/$dir" --title="$title" &
    else
        # Windows or other - just echo the command
        echo "cd $PWD/$dir"
    fi
}

echo "Opening development terminals..."

# Open terminals in different directories
open_terminal "portal-production" "Portal Production"
open_terminal "api-server-production" "API Server"
open_terminal "." "Root"

echo "Terminals opened! Check your terminal application." 