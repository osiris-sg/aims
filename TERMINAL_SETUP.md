# Terminal Setup Guide for AIMS Project

## Quick Terminal Setup in VS Code

### Method 1: Manual Terminal Creation (Recommended)

1. **Open VS Code** in the AIMS project folder
2. **Open Terminal Panel**: `Cmd+Shift+`` (backtick)
3. **Create 3 Terminals**:
   - **Terminal 1**: `cd portal-production && npm run dev`
   - **Terminal 2**: `cd api-server-production && npm run start:dev`
   - **Terminal 3**: Stay in root (for git, etc.)

### Method 2: Use VS Code Tasks

1. **Press `Cmd+Shift+P`** → "Tasks: Run Task"
2. **Select tasks one by one**:
   - "Open Portal Terminal"
   - "Open API Terminal"
   - "Open Root Terminal"

### Method 3: Use Shell Script

```bash
./open-terminals.sh
```

### Method 4: VS Code Terminal Shortcuts

- `Cmd+Shift+`` - New terminal
- `Cmd+Shift+5` - Split terminal horizontally
- `Cmd+Shift+6` - Split terminal vertically
- `Cmd+Shift+[` - Previous terminal
- `Cmd+Shift+]` - Next terminal

## Recommended Workflow

1. **Terminal 1** (Portal): `cd portal-production && npm run dev`
2. **Terminal 2** (API): `cd api-server-production && npm run start:dev`
3. **Terminal 3** (Root): For git commands, package management, etc.

## Troubleshooting

- If terminals don't open automatically, use Method 1 (Manual)
- The shell script opens external Terminal.app windows
- VS Code tasks are more reliable than automatic execution
